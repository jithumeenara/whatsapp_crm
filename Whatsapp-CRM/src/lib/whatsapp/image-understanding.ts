/**
 * Reads an image or a file a customer sent on WhatsApp, for the Inbox and
 * for the assistant. Called from the webhook only when the account has
 * switched reading on for that kind (lib/ai/image-settings.ts), and shaped
 * like audio-transcription.ts: never throws, returns null for anything it
 * cannot do, and the message stays in the Inbox for a person either way.
 *
 * Gemini only: it is the provider every account here has, and every
 * Gemini 3 model reads images and PDFs. With no Gemini key there is
 * nothing to do.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { getProviderKeys } from '@/lib/ai/providers/registry'
import {
  formatReading,
  isReadableFile,
  isReadableImage,
  MAX_FILE_BYTES,
  readImage,
  type ImageReading,
  type MediaSource,
} from '@/lib/ai/image-reading'
import { recordAiUsage } from '@/lib/ai/usage'
import { emitToAccount } from '@/lib/socket'

export interface InboundImageReading {
  reading: ImageReading
  /** What was stored on the message and shown in the Inbox. */
  stored: string
  /** The customer's own recent words — the language to answer in. */
  languageSample: string
  source: MediaSource
  filename: string | null
}

export async function readInboundImage(args: {
  accountId: string
  messageId: string
  mediaId: string
  accessToken: string
  caption: string | null
  conversationId: string
  /** 'image' for a photo (also one sent as a file); 'file' for a PDF or text file. */
  source?: MediaSource
  filename?: string | null
}): Promise<InboundImageReading | null> {
  const source = args.source ?? 'image'
  const feature = source === 'file' ? 'file_reading' : 'image_reading'
  const startedAt = Date.now()
  let model = 'gemini-3.6-flash'
  try {
    const aiConfig = await prisma.aiConfig.findUnique({ where: { account_id: args.accountId } })
    const gemini = aiConfig ? getProviderKeys(aiConfig).gemini : undefined
    if (!gemini?.api_key) return null
    model = gemini.model || model

    const { url, mimeType } = await getMediaUrl({ mediaId: args.mediaId, accessToken: args.accessToken })
    const { buffer } = await downloadMedia({ downloadUrl: url, accessToken: args.accessToken })
    const readable =
      source === 'file'
        ? isReadableFile(mimeType, buffer.length) || isReadableImage(mimeType, buffer.length, MAX_FILE_BYTES)
        : isReadableImage(mimeType, buffer.length)
    if (!readable) {
      console.warn(`[media-reading] skipped a ${source}: ${mimeType}, ${buffer.length} bytes`)
      return null
    }

    const languageSample = await customerWords(args.conversationId, args.caption)
    const reading = await readImage({
      apiKey: decrypt(gemini.api_key),
      model,
      image: buffer,
      mimeType,
      source,
      filename: args.filename,
      caption: args.caption,
      languageSample,
    })
    void recordAiUsage({
      accountId: args.accountId,
      model: reading.model,
      feature,
      tokens: reading.usage,
      latencyMs: Date.now() - startedAt,
    })

    const stored = formatReading(reading, source)
    // On `transcript`, beside the caption rather than over it: the
    // caption is what the customer wrote, and stays theirs.
    const updated = await prisma.message.update({ where: { id: args.messageId }, data: { transcript: stored } })
    emitToAccount(args.accountId, 'message', { eventType: 'UPDATE', new: updated, old: {} })
    return { reading, stored, languageSample, source, filename: args.filename ?? null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[media-reading] failed:', message)
    void recordAiUsage({
      accountId: args.accountId,
      model,
      feature,
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
