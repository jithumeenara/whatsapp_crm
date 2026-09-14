/**
 * Google Cloud Text-to-Speech.
 *
 * Preferred over the Gemini TTS path for every reason that matters here,
 * all measured against the live API rather than assumed:
 *
 *   - **Speed.** ~1 second per reply against ~8 for Gemini TTS. That
 *     difference sits directly in a customer's wait.
 *   - **Malayalam.** 38 native ml-IN Chirp3-HD voices. Gemini TTS speaks
 *     Malayalam with an English-trained voice, which a native speaker
 *     hears immediately.
 *   - **The right container.** It returns OGG/Opus directly, which is
 *     what WhatsApp renders as a real voice note with a waveform. MP3
 *     arrives as a file attachment instead. It also removes the pure-JS
 *     MP3 encoder from the path entirely.
 *
 * Gemini TTS stays as the fallback: it needs only the account's existing
 * API key, whereas this needs a Google Cloud service account that not
 * every deployment will have.
 */

import { getAccessToken, hasCloudCredentials, clearTokenCache, type ServiceAccount } from './google-auth'
import { CLOUD_VOICE_CHARACTERS } from './cloud-voices'

const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'

/**
 * Longest sentence sent in one request.
 *
 * Deliberately conservative. Google does not publish the exact ceiling
 * and the error does not name it, so this is set well below where it was
 * observed to fail — the cost of a chunk more is a join, the cost of one
 * too few is the whole reply falling back to the slow voice.
 */
const MAX_SENTENCE_CHARS = 180

/**
 * Breaks text into pieces Chirp will accept.
 *
 * Sentence boundaries first, since those are where a pause belongs
 * anyway. A sentence still over the limit is split at its commas, and a
 * clause still over it at word boundaries — each step less natural than
 * the last, which is why they are tried in that order.
 */
export function splitForSynthesis(text: string, maxChars = MAX_SENTENCE_CHARS): string[] {
  // Nothing to do for the common case. Splitting a short reply into its
  // sentences would cost an extra request and force MP3, losing the real
  // voice-note rendering for no reason at all — the limit is per
  // sentence, and every sentence in a short reply is already under it.
  if (text.length <= maxChars) return [text]

  // Malayalam and Hindi end sentences with । as well as . — and the
  // assistant writes in whichever language the customer used.
  const sentences = text
    .split(/(?<=[.!?।॥])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const pieces: string[] = []
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      pieces.push(sentence)
      continue
    }
    for (const clause of splitLongRun(sentence, maxChars)) pieces.push(clause)
  }
  return pieces.length > 0 ? pieces : [text]
}

function splitLongRun(sentence: string, maxChars: number): string[] {
  const out: string[] = []
  let current = ''

  const flush = () => {
    if (current.trim()) out.push(current.trim())
    current = ''
  }

  // Commas first — a listener hears a pause there without noticing one
  // was inserted.
  for (const clause of sentence.split(/(?<=[,;:،])/)) {
    if ((current + clause).length > maxChars && current) flush()
    if (clause.length > maxChars) {
      // No punctuation left to use. Words are the last boundary that
      // does not cut a word in half.
      flush()
      let line = ''
      for (const word of clause.split(/\s+/)) {
        if ((line + ' ' + word).trim().length > maxChars && line) {
          out.push(line.trim())
          line = ''
        }
        line = line ? `${line} ${word}` : word
      }
      if (line.trim()) current = line
      continue
    }
    current += clause
  }
  flush()
  return out
}
const TTS_TIMEOUT_MS = 15_000

/** WhatsApp renders OGG/Opus as a voice note with a waveform and plays
 *  MP3 as an attached file. Both are accepted; only one looks like a
 *  person replying. */
export type CloudAudioEncoding = 'OGG_OPUS' | 'MP3'

export interface CloudSpeechResult {
  buffer: Buffer
  mimeType: 'audio/ogg' | 'audio/mpeg'
  voiceUsed: string
  languageCode: string
}

/**
 * Language code per script, so a Malayalam reply is spoken by a
 * Malayalam voice.
 *
 * Chosen from the reply text rather than from a setting, for the same
 * reason the reply language itself is: the customer decides, per
 * message. Detection here only has to be good enough to pick a voice —
 * a wrong guess sounds accented, it does not say the wrong words.
 */
const SCRIPT_LANGUAGES: { test: RegExp; languageCode: string }[] = [
  { test: /[\u0D00-\u0D7F]/, languageCode: 'ml-IN' },
  { test: /[\u0B80-\u0BFF]/, languageCode: 'ta-IN' },
  { test: /[\u0C00-\u0C7F]/, languageCode: 'te-IN' },
  { test: /[\u0C80-\u0CFF]/, languageCode: 'kn-IN' },
  { test: /[\u0900-\u097F]/, languageCode: 'hi-IN' },
  { test: /[\u0980-\u09FF]/, languageCode: 'bn-IN' },
  { test: /[\u0A80-\u0AFF]/, languageCode: 'gu-IN' },
  { test: /[\u0600-\u06FF]/, languageCode: 'ar-XA' },
]

/** English (India) rather than en-US: the customer base is Indian, and
 *  romanized Malayalam read by an Indian-English voice lands far closer
 *  than an American one. */
const DEFAULT_LANGUAGE = 'en-IN'

export function detectSpeechLanguage(text: string): string {
  const match = SCRIPT_LANGUAGES.find((s) => s.test.test(text))
  return match ? match.languageCode : DEFAULT_LANGUAGE
}

/**
 * The voice name is built from the language and a chosen "character".
 *
 * Chirp3-HD voice names are `<lang>-Chirp3-HD-<Character>`, and the same
 * character exists across languages — so an account picks "Achernar"
 * once and gets a consistent-sounding assistant whether it is answering
 * in Malayalam or English, without configuring a voice per language.
 */
export { CLOUD_VOICE_CHARACTERS, type CloudVoiceCharacter } from './cloud-voices'

export function buildVoiceName(languageCode: string, character: string): string {
  const known = CLOUD_VOICE_CHARACTERS.some((v) => v.id === character)
  return `${languageCode}-Chirp3-HD-${known ? character : 'Achernar'}`
}

/** True when this server has a shared service account. An account with
 *  its own uploaded key does not need one — see speech.ts. */
export function cloudTtsAvailable(): boolean {
  return hasCloudCredentials()
}

/**
 * Speaks `text`.
 *
 * Throws when Cloud TTS is unavailable or fails — the caller decides
 * whether to fall back to the built-in voice or send text instead.
 */
export async function synthesizeWithCloudTts(args: {
  text: string
  /** Voice character; the language half is derived from the text. */
  character?: string
  /** Overrides script detection. Used by the test screen. */
  languageCode?: string
  encoding?: CloudAudioEncoding
  /** 0.25–4.0. Slightly under 1 reads more clearly on a phone speaker. */
  speakingRate?: number
  /** The account's own service account. Falls back to the environment's
   *  shared one when absent. */
  account?: ServiceAccount | null
}): Promise<CloudSpeechResult> {
  if (!args.account && !hasCloudCredentials()) {
    throw new Error('Google Cloud Text-to-Speech is not set up for this account.')
  }

  const text = args.text.trim()
  if (!text) throw new Error('Nothing to speak.')

  const languageCode = args.languageCode ?? detectSpeechLanguage(text)
  const voiceName = buildVoiceName(languageCode, args.character ?? 'Achernar')
  const pieces = splitForSynthesis(text)

  // One piece keeps OGG/Opus, which WhatsApp renders as a real voice
  // note. Several go out as MP3: MP3 frames concatenate cleanly, while
  // two Ogg streams joined end to end form a chained stream that not
  // every player follows past the first. A voice note that plays as
  // plain audio beats one that looks right and stops halfway.
  const encoding: CloudAudioEncoding =
    args.encoding ?? (pieces.length > 1 ? 'MP3' : 'OGG_OPUS')

  const call = async (token: string, body: string) =>
    fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    })

  const requestFor = (piece: string) =>
    JSON.stringify({
        input: { text: piece },
        voice: { languageCode, name: voiceName },
        audioConfig: {
          audioEncoding: encoding,
          speakingRate: args.speakingRate ?? 1.0,
          // Chirp3-HD voices reject pitch adjustment, so it is not sent.
        },
    })

  const scope = 'https://www.googleapis.com/auth/cloud-platform'
  let token = await getAccessToken(scope, args.account)

  const speakPiece = async (piece: string): Promise<Buffer> => {
    let res = await call(token, requestFor(piece))

    // A cached token can outlive a rotated key. One retry with a fresh
    // token distinguishes "credentials revoked" from "cache went stale".
    // Scoped to this identity so one account's 401 does not evict every
    // other account's perfectly good token.
    if (res.status === 401) {
      clearTokenCache(args.account)
      token = await getAccessToken(scope, args.account)
      res = await call(token, requestFor(piece))
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Cloud TTS returned ${res.status}: ${body.slice(0, 200)}`)
    }

    const json = (await res.json()) as { audioContent?: string }
    if (!json.audioContent) throw new Error('Cloud TTS returned no audio.')
    return Buffer.from(json.audioContent, 'base64')
  }

  // Sequential, not parallel. Several requests at once risk a rate limit
  // on an account that has never hit one, and a reply is a handful of
  // pieces at most — the round trips are not what makes this slow.
  const buffers: Buffer[] = []
  for (const piece of pieces) buffers.push(await speakPiece(piece))

  return {
    buffer: buffers.length === 1 ? buffers[0] : Buffer.concat(buffers),
    mimeType: encoding === 'OGG_OPUS' ? 'audio/ogg' : 'audio/mpeg',
    voiceUsed: voiceName,
    languageCode,
  }
}
