/**
 * Reads an image a customer sent on WhatsApp, for the Inbox and for the
 * assistant. Called from the webhook only when the account has switched
 * "Read images customers send" on (lib/ai/image-settings.ts), and shaped
 * like audio-transcription.ts: never throws, returns null for anything it
 * cannot do, and the image stays in the Inbox for a person either way.
 *
 * Gemini only: it is the provider every account here has, and every
 * Gemini 3 model reads images. With no Gemini key there is nothing to do.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import { formatReading, isReadableImage, MAX_IMAGE_BYTES, readImage, type ImageReading } from '@/lib/ai/image-reading'
import { recordAiUsage } from '@/lib/ai/usage'
import { emitToAccount } from '@/lib/socket'

export interface InboundImageReading {
  reading: ImageReading
  /** What was stored on the message and shown in the Inbox. */
  stored: string
  /** The customer's own recent words — the language to answer in. */
  languageSample: string
}

export async function readInboundImage(args: {
  accountId: string
  messageId: string
  mediaId: string
  accessToken: string
  caption: string | null
  conversationId: string
}): Promise<InboundImageReading | null> {
  const startedAt = Date.now()
  let model = 'gemini-3.6-flash'
  try {
    const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
    const gemini = aiConfig ? getProviderKeys(aiConfig).gemini : undefined
    if (!gemini?.api_key) return null
    model = gemini.model || model

    const { url, mimeType } = await getMediaUrl({ mediaId: args.mediaId, accessToken: args.accessToken })
    const { buffer } = await downloadMedia({ downloadUrl: url, accessToken: args.accessToken })
    if (!isReadableImage(mimeType, buffer.length)) {
      console.warn(
        `[image-reading] skipped an image: ${mimeType}, ${buffer.length} bytes (limit ${MAX_IMAGE_BYTES})`,
      )
      return null
    }

    const languageSample = await customerWords(args.conversationId, args.caption)
    const reading = await readImage({
      apiKey: decrypt(gemini.api_key),
      model,
      image: buffer,
      mimeType,
      caption: args.caption,
      languageSample,
    })
    void recordAiUsage({
      accountId: args.accountId,
      model: reading.model,
      feature: 'image_reading',
      tokens: reading.usage,
      latencyMs: Date.now() - startedAt,
    })

    const stored = formatReading(reading)
    // On `transcript`, beside the caption rather than over it: the
    // caption is what the customer wrote, and stays theirs.
    const updated = await prisma.message.update({ where: { id: args.messageId }, data: { transcript: stored } })
    emitToAccount(args.accountId, 'message', { eventType: 'UPDATE', new: updated, old: {} })
    return { reading, stored, languageSample }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[image-reading] failed:', message)
    void recordAiUsage({
      accountId: args.accountId,
      model,
      feature: 'image_reading',
      status: 'error',
      error: message,
      latencyMs: Date.now() - startedAt,
    })
    return null
  }
}

/** The customer's own recent words — the language to ask them in. Their
 *  caption first; their last few typed messages after it. */
async function customerWords(conversationId: string, caption: string | null): Promise<string> {
  const recent = await prisma.message
    .findMany({
      where: { conversation_id: conversationId, sender_type: 'customer', content_type: 'text' },
      orderBy: { created_at: 'desc' },
      take: 3,
      select: { content_text: true },
    })
    .catch(() => [] as { content_text: string | null }[])
  return [caption ?? '', ...recent.map((m) => m.content_text ?? '')].filter(Boolean).join(' ').slice(0, 400)
}
