/**
 * Turns what a Gemini TTS model returns into 16-bit mono samples.
 *
 * Two shapes arrive. The older voices (3.1 Flash TTS Preview and before)
 * send headerless 16-bit PCM and name the rate in the mime type
 * ("audio/L16;codec=pcm;rate=24000"). Gemini 3.8 TTS sends a WAV file
 * instead — "Gemini 3.8 TTS returns WAV audio (audio/wav) with a standard
 * RIFF header by default", per Google's speech-generation guide. Read as
 * raw PCM, a WAV's 44-byte header becomes a click at the start and its
 * rate is lost from the mime type, so it is parsed properly here.
 */

export interface DecodedAudio {
  pcm: Int16Array
  sampleRate: number
}

const DEFAULT_RATE = 24_000

export function decodeTtsAudio(bytes: Buffer, mimeType: string | undefined): DecodedAudio {
  if (isWav(bytes)) return decodeWav(bytes)
  return { pcm: toInt16(bytes), sampleRate: rateFromMime(mimeType) }
}

function isWav(b: Buffer): boolean {
  return b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE'
}

function decodeWav(b: Buffer): DecodedAudio {
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null
  let offset = 12
  while (offset + 8 <= b.length) {
    const id = b.toString('ascii', offset, offset + 4)
    const declared = b.readUInt32LE(offset + 4)
    const start = offset + 8
    // A streamed WAV may declare 0 or 0xFFFFFFFF for "unknown"; never
    // read past what actually arrived.
    const size = Math.min(declared === 0 || declared === 0xffffffff ? b.length - start : declared, b.length - start)

    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: b.readUInt16LE(start),
        channels: b.readUInt16LE(start + 2),
        sampleRate: b.readUInt32LE(start + 4),
        bits: b.readUInt16LE(start + 14),
      }
    } else if (id === 'data') {
      if (!format) throw new Error('The voice audio arrived without its format description.')
      if (format.audioFormat !== 1 || format.bits !== 16) {
        throw new Error(`The voice audio is in a format this app cannot play (format ${format.audioFormat}, ${format.bits}-bit).`)
      }
      if (format.channels < 1 || format.sampleRate < 8_000 || format.sampleRate > 96_000) {
        throw new Error('The voice audio describes itself impossibly.')
      }
      const samples = toInt16(b.subarray(start, start + size))
      return { pcm: format.channels === 1 ? samples : toMono(samples, format.channels), sampleRate: format.sampleRate }
    }
    // Chunks are padded to an even length.
    offset = start + size + (size % 2)
  }
  throw new Error('The voice audio had no sound in it.')
}

function toInt16(buf: Buffer): Int16Array {
  const samples = new Int16Array(Math.floor(buf.length / 2))
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2)
  return samples
}

function toMono(interleaved: Int16Array, channels: number): Int16Array {
  const frames = Math.floor(interleaved.length / channels)
  const mono = new Int16Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += interleaved[f * channels + c]
    mono[f] = Math.round(sum / channels)
  }
  return mono
}

/** The rate is declared in the mime type ("audio/L16; rate=24000"), not
 *  fixed by the API contract. Reading it rather than hardcoding 24000
 *  means a model that returns 16 kHz plays at the right pitch instead of
 *  sounding like a chipmunk. */
function rateFromMime(mimeType: string | undefined): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? '')
  const rate = match ? Number(match[1]) : DEFAULT_RATE
  return rate >= 8_000 && rate <= 96_000 ? rate : DEFAULT_RATE
}
