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

import { synthesizeWithCloudTts, cloudTtsAvailable, detectSpeechLanguage } from './cloud-tts'
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
  /** The account's own Gemini key, for the fallback engine. */
  geminiApiKey?: string | null
  /** Cloud TTS voice character. */
  cloudVoice?: string
  /** Gemini prebuilt voice name, used only by the fallback. */
  geminiVoice?: string
}): Promise<SpeechOutput> {
  if (cloudTtsAvailable()) {
    try {
      const result = await synthesizeWithCloudTts({ text: args.text, character: args.cloudVoice })
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
  return {
    buffer: result.buffer,
    mimeType: result.mimeType,
    engine: 'gemini',
    durationSec: result.durationSec,
    languageCode: detectSpeechLanguage(args.text),
  }
}

/** Which engine a reply would use, for the Settings screen to report
 *  honestly instead of promising Cloud quality on a server without it. */
export function activeSpeechEngine(): SpeechEngine {
  return cloudTtsAvailable() ? 'cloud' : 'gemini'
}
