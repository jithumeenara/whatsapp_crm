/**
 * Text to speech, for answering a voice note with a voice note.
 *
 * Two things here are not obvious and both were established by testing
 * against the live API rather than assumed:
 *
 * 1. Gemini's TTS models return raw PCM — `audio/L16; rate=24000;
 *    channels=1` — not a container format. WhatsApp accepts audio/aac,
 *    audio/amr, audio/mpeg, audio/mp4 and audio/ogg(opus). Raw PCM and
 *    WAV are on neither list, so the bytes that come back cannot be
 *    forwarded as they are; they have to be encoded first.
 *
 * 2. The encoder has to be pure JavaScript. ffmpeg would be the obvious
 *    tool and is not installed on the production VPS, so reaching for it
 *    would produce a feature that works on a developer machine and
 *    silently fails for real customers. lamejs runs anywhere Node runs.
 *
 * MP3 rather than Opus is a deliberate trade: Opus would render as a
 * true voice-note waveform in WhatsApp, but encoding it in pure JS is
 * considerably heavier. An MP3 arrives as a playable audio message,
 * which is what the customer actually needs.
 */
import { TTS_VOICES } from './tts-voices'

/**
 * The MP3 encoder, loaded on demand.
 *
 * Loaded through a dynamic `import()` rather than a top-level one, for a
 * packaging reason found by running it: the library declares
 *
 *     "exports": { "default": { "import": "./dist/lamejs.js",
 *                               "require": "./dist/lamejs.iife.js" } }
 *
 * and the `require` target is an IIFE bundle that assigns to a global
 * and exports an empty object. Any context that resolves this package
 * through CommonJS therefore gets `{}` and fails with "Mp3Encoder is not
 * a constructor". A dynamic import always takes the `import` condition,
 * so it gets the real ESM build regardless of how the calling module was
 * compiled.
 *
 * Loading it lazily is a bonus rather than the motive: it is a ~260 KB
 * bundle needed only when an account actually answers a voice note.
 */
type Mp3EncoderCtor = new (channels: number, sampleRate: number, kbps: number) => {
  encodeBuffer(left: Int16Array): Uint8Array
  flush(): Uint8Array
}

let encoderPromise: Promise<Mp3EncoderCtor> | null = null

function loadMp3Encoder(): Promise<Mp3EncoderCtor> {
  encoderPromise ??= import('@breezystack/lamejs').then((mod) => {
    const ns = mod as unknown as {
      Mp3Encoder?: Mp3EncoderCtor
      default?: { Mp3Encoder?: Mp3EncoderCtor }
    }
    const ctor = typeof ns.Mp3Encoder === 'function' ? ns.Mp3Encoder : ns.default?.Mp3Encoder
    if (typeof ctor !== 'function') {
      // Cleared so a later attempt can retry rather than being poisoned
      // by one bad load.
      encoderPromise = null
      throw new Error('The MP3 encoder could not be loaded, so a voice reply cannot be produced.')
    }
    return ctor
  })
  return encoderPromise
}

/** The TTS-capable models this account may have access to, newest
 *  first. Confirmed present on the live models list (Sept 2026); the
 *  fallback matters because preview models are withdrawn without
 *  notice and a missing model must not take voice replies down. */
const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']

// Gemini's prebuilt voices live in their own module so the Settings
// screen can list them without importing this file's encoder.
export { TTS_VOICES } from './tts-voices'

/** Speech is slow to generate relative to text and sits directly in the
 *  customer's wait. Past this point the text reply has already been the
 *  better answer for a while. */
const TTS_TIMEOUT_MS = 25_000

/** 24 kHz mono at 48 kbps: speech is intelligible well below music
 *  bitrates, and a smaller file reaches a phone on mobile data sooner. */
const MP3_BITRATE_KBPS = 48
/** One MPEG-1 Layer III frame. The encoder expects whole frames. */
const SAMPLES_PER_FRAME = 1152

export type SpeechResult = { buffer: Buffer; mimeType: 'audio/mpeg'; durationSec: number }

/**
 * Speaks `text`, returning MP3 bytes ready to upload to WhatsApp.
 *
 * Throws on failure rather than returning null — the caller decides
 * whether a voice reply is worth failing over, and every current caller
 * answers "no, send the text instead".
 */
export async function synthesizeSpeech(args: {
  apiKey: string
  text: string
  voiceName?: string
}): Promise<SpeechResult> {
  const voiceName = resolveVoice(args.voiceName)
  const spoken = stripForSpeech(args.text)
  if (!spoken) throw new Error('Nothing to speak once formatting was removed.')

  let lastError: Error | null = null
  for (const model of TTS_MODELS) {
    try {
      const { pcm, sampleRate } = await requestPcm({ apiKey: args.apiKey, model, text: spoken, voiceName })
      const buffer = await pcmToMp3(pcm, sampleRate)
      return { buffer, mimeType: 'audio/mpeg', durationSec: pcm.length / sampleRate }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Try the next model only for "this model is gone" style failures.
      // A bad API key or a quota block will fail identically on both, and
      // retrying just doubles the customer's wait.
      if (!isModelUnavailable(lastError)) throw lastError
    }
  }
  throw lastError ?? new Error('Speech synthesis failed.')
}

function resolveVoice(requested?: string): string {
  const match = TTS_VOICES.find((v) => v.id === requested)
  return match ? match.id : 'Kore'
}

function isModelUnavailable(err: Error): boolean {
  return /404|not found|not supported|unavailable/i.test(err.message)
}

async function requestPcm(args: {
  apiKey: string
  model: string
  text: string
  voiceName: string
}): Promise<{ pcm: Int16Array; sampleRate: number }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: args.text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: args.voiceName } } },
        },
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`TTS ${args.model} returned ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[]
  }
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
  if (!inline?.data) throw new Error(`TTS ${args.model} returned no audio.`)

  return {
    pcm: bytesToInt16(Buffer.from(inline.data, 'base64')),
    sampleRate: parseSampleRate(inline.mimeType),
  }
}

/** The rate is declared in the mime type ("audio/L16; rate=24000"), not
 *  fixed by the API contract. Reading it rather than hardcoding 24000
 *  means a model that returns 16 kHz plays at the right pitch instead of
 *  sounding like a chipmunk. */
function parseSampleRate(mimeType: string | undefined): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? '')
  return match ? Number(match[1]) : 24_000
}

/** Signed 16-bit little-endian, which is what L16 means. */
function bytesToInt16(buf: Buffer): Int16Array {
  const samples = new Int16Array(Math.floor(buf.length / 2))
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2)
  return samples
}

async function pcmToMp3(pcm: Int16Array, sampleRate: number): Promise<Buffer> {
  const Encoder = await loadMp3Encoder()
  const encoder = new Encoder(1, sampleRate, MP3_BITRATE_KBPS)
  const chunks: Buffer[] = []
  for (let offset = 0; offset < pcm.length; offset += SAMPLES_PER_FRAME) {
    const frame = encoder.encodeBuffer(pcm.subarray(offset, offset + SAMPLES_PER_FRAME))
    if (frame.length > 0) chunks.push(Buffer.from(frame))
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(Buffer.from(tail))
  return Buffer.concat(chunks)
}

/**
 * Removes anything that is formatting rather than words.
 *
 * WhatsApp's own markers are the important case: a reply containing
 * *Admissions* is read aloud as "asterisk admissions asterisk" if it is
 * passed through untouched, which is how the voice preview sounded
 * before this existed. List bullets become pauses rather than the word
 * "dash".
 */
export function stripForSpeech(text: string): string {
  return (text || '')
    // WhatsApp bold/italic/strike markers, kept only when they wrap text.
    .replace(/[*_~]{1,2}([^*_~\n]+)[*_~]{1,2}/g, '$1')
    // Code fences and inline backticks.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Markdown links -> just the label.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Leading list markers become a sentence break, so the reader pauses.
    .replace(/^[ \t]*[-*•][ \t]+/gm, '. ')
    .replace(/^[ \t]*(\d{1,2})[.)][ \t]+/gm, '. ')
    // Bare URLs are unlistenable; say so instead of spelling them out.
    .replace(/https?:\/\/\S+/g, 'the link in the message')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s*\.\s*\./g, '.')
    // A bullet turned into ". " can leave "Options: . One" — the space
    // before the stop makes a reader pause in the wrong place.
    .replace(/\s+\./g, '.')
    // Re-separate a stop that ended up glued to the next sentence.
    //
    // Restricted to a following capital letter on purpose. The obvious
    // rule — a space after any period followed by a non-space — reads
    // "4.5" as "4. 5" and "45000.50" as two numbers, which is the exact
    // failure this whole feature exists to avoid. It would also break
    // "acsti.in". A capital after the stop is the one case that is
    // reliably a sentence boundary.
    .replace(/\.(?=[A-Zഀ-ൿ])/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
