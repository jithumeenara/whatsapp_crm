/**
 * Admin Chat voice: an admin's voice note (Malayalam or English) becomes
 * the question, and the answer comes back as a voice note too.
 *
 * Uses the account's own transcription (Gemini or OpenAI) and Gemini
 * speech — the same engines the customer side uses, tested on Malayalam.
 * Both are best effort: a note that cannot be heard gets "please type it",
 * and a reply that cannot be spoken is still sent as text.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { pickTranscriptionProvider, transcribeAudio } from '@/lib/ai/transcription'
import { synthesizeSpeech } from '@/lib/ai/tts'
import { recordAiUsage } from '@/lib/ai/usage'

/** Longer answers (lists) are read, not listened to. */
export const MAX_SPOKEN_CHARS = 700
/** Telegram gives bots files up to 20 MB; a voice question is far smaller. */
export const MAX_VOICE_BYTES = 10 * 1024 * 1024

export async function transcribeForAdmin(accountId: string, audio: { buffer: Buffer; mimeType: string }): Promise<string | null> {
  if (audio.buffer.length === 0 || audio.buffer.length > MAX_VOICE_BYTES) return null
  const config = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  if (!config) return null
  const picked = pickTranscriptionProvider(getProviderKeys(config))
  if (!picked) return null
  const startedAt = Date.now()
  try {
    const result = await transcribeAudio({ provider: picked.provider, apiKey: decrypt(picked.entry.api_key), audioBuffer: audio.buffer, mimeType: audio.mimeType })
    void recordAiUsage({ accountId, provider: picked.provider, model: result.model, feature: 'transcription', tokens: result.usage, latencyMs: Date.now() - startedAt })
    const text = result.text.trim()
    return text || null
  } catch (err) {
    console.error('[admin-chat] transcription failed:', err instanceof Error ? err.message : err)
    void recordAiUsage({ accountId, provider: picked.provider, model: 'transcription', feature: 'transcription', status: 'error', error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - startedAt })
    return null
  }
}

/** MP3 of the answer, or null (no Gemini key, too long, or the engine failed). */
export async function speakForAdmin(accountId: string, text: string): Promise<Buffer | null> {
  if (!text.trim() || text.length > MAX_SPOKEN_CHARS) return null
  const config = await prisma.aiConfig.findUnique({ where: { account_id: accountId } })
  const gemini = config ? getProviderKeys(config).gemini : undefined
  if (!gemini?.api_key) return null
  const startedAt = Date.now()
  try {
    const speech = await synthesizeSpeech({ apiKey: decrypt(gemini.api_key), text })
    void recordAiUsage({ accountId, model: 'tts', feature: 'tts', tokens: speech.usage, latencyMs: Date.now() - startedAt })
    return speech.buffer
  } catch (err) {
    console.error('[admin-chat] speech failed:', err instanceof Error ? err.message : err)
    return null
  }
}
