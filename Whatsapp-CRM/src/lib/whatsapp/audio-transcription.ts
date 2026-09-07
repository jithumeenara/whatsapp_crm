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
import { emitToAccount } from '@/lib/socket'

export async function transcribeInboundAudio(args: {
  accountId: string
  messageId: string
  mediaId: string
  /** Already-decrypted WhatsApp access token for this account — the
   *  webhook handler already has this decrypted for the inbound-message
   *  send path, no reason to decrypt it a second time here. */
  accessToken: string
}): Promise<void> {
  try {
    const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
    if (!aiConfig) return // no AI configured at all — nothing to transcribe with

    const picked = pickTranscriptionProvider(getProviderKeys(aiConfig))
    if (!picked) return // only Gemini/OpenAI support transcription; neither is configured

    const { url, mimeType } = await getMediaUrl({ mediaId: args.mediaId, accessToken: args.accessToken })
    const { buffer } = await downloadMedia({ downloadUrl: url, accessToken: args.accessToken })

    const transcript = await transcribeAudio({
      provider: picked.provider,
      apiKey: decrypt(picked.entry.api_key),
      audioBuffer: buffer,
      mimeType,
    })

    const updated = await prisma.message.update({
      where: { id: args.messageId },
      // Mirrored into content_text so reply-quote previews and the
      // conversation list show real content instead of "[Audio]" — this
      // deliberately does NOT re-run automations/flow dispatch for this
      // message; that already happened (or didn't) at inbound time.
      data: { transcript, content_text: transcript },
    })

    emitToAccount(args.accountId, 'message', { eventType: 'UPDATE', new: updated, old: {} })
  } catch (err) {
    console.error('[audio-transcription] failed:', err instanceof Error ? err.message : err)
  }
}
