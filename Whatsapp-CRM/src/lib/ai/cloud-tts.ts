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

import { getAccessToken, hasCloudCredentials, clearTokenCache } from './google-auth'
import { CLOUD_VOICE_CHARACTERS } from './cloud-voices'

const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
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
}): Promise<CloudSpeechResult> {
  if (!hasCloudCredentials()) {
    throw new Error('Google Cloud Text-to-Speech is not configured on this server.')
  }

  const text = args.text.trim()
  if (!text) throw new Error('Nothing to speak.')

  const languageCode = args.languageCode ?? detectSpeechLanguage(text)
  const voiceName = buildVoiceName(languageCode, args.character ?? 'Achernar')
  const encoding: CloudAudioEncoding = args.encoding ?? 'OGG_OPUS'

  const call = async (token: string) =>
    fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voiceName },
        audioConfig: {
          audioEncoding: encoding,
          speakingRate: args.speakingRate ?? 1.0,
          // Chirp3-HD voices reject pitch adjustment, so it is not sent.
        },
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    })

  let res = await call(await getAccessToken())

  // A cached token can outlive a rotated key. One retry with a fresh
  // token distinguishes "credentials revoked" from "cache went stale".
  if (res.status === 401) {
    clearTokenCache()
    res = await call(await getAccessToken())
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Cloud TTS returned ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as { audioContent?: string }
  if (!json.audioContent) throw new Error('Cloud TTS returned no audio.')

  return {
    buffer: Buffer.from(json.audioContent, 'base64'),
    mimeType: encoding === 'OGG_OPUS' ? 'audio/ogg' : 'audio/mpeg',
    voiceUsed: voiceName,
    languageCode,
  }
}
