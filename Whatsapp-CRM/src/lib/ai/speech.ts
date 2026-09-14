/**
 * One way to turn a reply into audio, whichever engine is available.
 *
 * Two engines, deliberately ordered:
 *
 *   1. **Google Cloud TTS** when the server has a service account.
 *      Faster (~1s vs ~8s), native voices for Malayalam and the other
 *      Indian languages this customer base actually writes in, and
 *      OGG/Opus output that WhatsApp renders as a real voice note.
 *   2. **Gemini TTS** otherwise. Needs only the account's own API key,
 *      so it works on a deployment with no Cloud project at all.
 *
 * Callers ask for speech and get it; which engine produced it is
 * reported back for logging, not for the caller to branch on.
 */

import { synthesizeWithCloudTts, detectSpeechLanguage } from './cloud-tts'
import { resolveTtsCredentials } from './tts-credentials'
import { synthesizeSpeech as synthesizeWithGemini } from './tts'

export type SpeechEngine = 'cloud' | 'gemini'

export interface SpeechOutput {
  buffer: Buffer
  /** audio/ogg for a true voice note, audio/mpeg for the fallback. */
  mimeType: string
  engine: SpeechEngine
  /** Best-effort; the Gemini path reports what it measured. */
  durationSec?: number
  voiceUsed?: string
  languageCode?: string
}

export async function speak(args: {
  text: string
  /** Whose uploaded service account to prefer. Without it, only the
   *  server's shared environment credential is considered. */
  accountId?: string
  /** The account's own Gemini key, for the fallback engine. */
  geminiApiKey?: string | null
  /** Cloud TTS voice character. */
  cloudVoice?: string
  /** Gemini prebuilt voice name, used only by the fallback. */
  geminiVoice?: string
}): Promise<SpeechOutput> {
  const credentials = args.accountId
    ? await resolveTtsCredentials(args.accountId)
    : { account: null, source: 'none' as const }

  // Measured across both engines so the log line is comparable: the
  // whole point of reading it is telling a one-second reply from a
  // six-second one.
  const startedAt = Date.now()

  if (credentials.account) {
    try {
      const result = await synthesizeWithCloudTts({
        text: args.text,
        character: args.cloudVoice,
        account: credentials.account,
      })
      console.log(
        `[speech] cloud · ${result.languageCode ?? '?'} · ${result.voiceUsed ?? 'default voice'} · ${Date.now() - startedAt}ms`,
      )
      return {
        buffer: result.buffer,
        mimeType: result.mimeType,
        engine: 'cloud',
        voiceUsed: result.voiceUsed,
        languageCode: result.languageCode,
      }
    } catch (err) {
      // Logged rather than thrown: a Cloud outage or a rotated key
      // should cost the nicer voice, not the voice reply itself.
      console.error(
        '[speech] Cloud TTS failed, falling back to the built-in voice:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  if (!args.geminiApiKey) {
    throw new Error('No speech engine is available: Cloud TTS is not configured and there is no Gemini key.')
  }

  const result = await synthesizeWithGemini({
    apiKey: args.geminiApiKey,
    text: args.text,
    voiceName: args.geminiVoice,
  })
  const elapsed = Date.now() - startedAt
  // Flagged rather than merely reported. This engine is fine for a voice
  // note, where nobody is waiting, and far too slow for a live call.
  console.log(
    `[speech] gemini · ${detectSpeechLanguage(args.text)} · ${elapsed}ms` +
      (elapsed > 2000 ? ' — too slow for a call; a Google Cloud key would make this ~1s' : ''),
  )
  return {
    buffer: result.buffer,
    mimeType: result.mimeType,
    engine: 'gemini',
    durationSec: result.durationSec,
    languageCode: detectSpeechLanguage(args.text),
  }
}

/** Which engine this account's replies would use — asked of the same
 *  resolver the send path uses, so Settings cannot claim Cloud quality
 *  the send path would not deliver. */
export async function activeSpeechEngine(accountId: string): Promise<SpeechEngine> {
  const { account } = await resolveTtsCredentials(accountId)
  return account ? 'cloud' : 'gemini'
}
