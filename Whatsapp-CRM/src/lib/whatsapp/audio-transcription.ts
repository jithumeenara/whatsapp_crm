/**
 * Best-effort transcription of an inbound WhatsApp voice note. Fire-and-
 * forget from the webhook handler (see processMessage in
 * src/app/api/whatsapp/webhook/route.ts) — never blocks the webhook's
 * ack-and-return, never throws, silently no-ops when neither Gemini nor
 * OpenAI is configured for the account (only those two support
 * transcription today).
 */
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { pickTranscriptionProvider, transcribeAudio } from '@/lib/ai/transcription'
import { recordAiUsage } from '@/lib/ai/usage'
import { emitToAccount } from '@/lib/socket'

export async function transcribeInboundAudio(args: {
  accountId: string
  messageId: string
  mediaId: string
  /** Already-decrypted WhatsApp access token for this account — the
   *  webhook handler already has this decrypted for the inbound-message
   *  send path, no reason to decrypt it a second time here. */
  accessToken: string
}): Promise<string | null> {
  try {
    const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
    if (!aiConfig) return null // no AI configured at all — nothing to transcribe with

    const picked = pickTranscriptionProvider(getProviderKeys(aiConfig))
    if (!picked) return null // only Gemini/OpenAI support transcription; neither is configured

    const { url, mimeType } = await getMediaUrl({ mediaId: args.mediaId, accessToken: args.accessToken })
    const { buffer } = await downloadMedia({ downloadUrl: url, accessToken: args.accessToken })

    // Recorded either way: a failed transcription still cost a call, and
    // "Voice notes in" was a Usage line that nothing ever wrote to.
    const startedAt = Date.now()
    let result
    try {
      result = await transcribeAudio({
        provider: picked.provider,
        apiKey: decrypt(picked.entry.api_key),
        audioBuffer: buffer,
        mimeType,
      })
    } catch (err) {
      void recordAiUsage({
        accountId: args.accountId,
        provider: picked.provider,
        model: picked.provider === 'gemini' ? 'gemini-3.5-transcribe' : 'gpt-transcribe',
        feature: 'transcription',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startedAt,
      })
      throw err
    }
    void recordAiUsage({
      accountId: args.accountId,
      provider: picked.provider,
      model: result.model,
      feature: 'transcription',
      tokens: result.usage,
      latencyMs: Date.now() - startedAt,
    })
    const transcript = result.text

    const updated = await prisma.message.update({
      where: { id: args.messageId },
      // Mirrored into content_text so reply-quote previews and the
      // conversation list show real content instead of "[Audio]".
      //
      // Flow dispatch for an audio message is deliberately deferred
      // until after this returns (see the webhook's processMessage) —
      // dispatching at inbound time handed the assistant an empty
      // string, so every voice note got a reply to nothing.
      data: { transcript, content_text: transcript },
    })

    emitToAccount(args.accountId, 'message', { eventType: 'UPDATE', new: updated, old: {} })
    return transcript
  } catch (err) {
    console.error('[audio-transcription] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
