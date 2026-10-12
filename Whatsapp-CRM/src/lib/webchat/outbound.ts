/**
 * Sending to a website visitor.
 *
 * Every other channel sends through a provider and then records what was
 * sent. Here the "provider" is the visitor's open window: the message is
 * recorded, the Inbox told, and the window sent it over the socket. A
 * window that is closed loses nothing — it reads the conversation back
 * when it next opens.
 *
 * Called by the flow engine's senders (chatbot steps, automations, the
 * assistant) and by the Inbox's send route (agents), so all of them reach
 * the visitor by one path.
 */

import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { pushVisitorMessage } from './realtime'
import { toVisitorMessage, isSafeHttpsUrl, type VisitorButton } from './public-message'

export interface WebsiteSendArgs {
  accountId: string
  conversationId: string
  senderType: 'bot' | 'agent'
  /** The agent, for an agent's message. */
  senderId?: string | null
  text: string
  contentType?: string
  media?: { url: string; mimeType?: string | null; filename?: string | null } | null
  buttons?: VisitorButton[]
  link?: { label: string; url: string } | null
  replyToMessageId?: string | null
}

export class WebsiteSendError extends Error {}

/** The provider-style id these messages carry, unique so the assistant
 *  can tag its own reply by it (markAsAssistantReply). */
function outboundId(): string {
  return `web_out:${crypto.randomUUID()}`
}

export async function sendToWebsiteVisitor(args: WebsiteSendArgs) {
  // The conversation must be this account's and a website one. Every
  // caller has already checked the account; this is the last line, and
  // it is cheap.
  const conversation = await prisma.conversation.findFirst({
    where: { id: args.conversationId, account_id: args.accountId, channel: 'website' },
    select: { id: true },
  })
  if (!conversation) throw new WebsiteSendError('Website conversation not found')

  const media = args.media && isSafeHttpsUrl(args.media.url) ? args.media : null
  const buttons = (args.buttons ?? []).filter((b) => b.id && b.title).slice(0, 10)
  const link = args.link && isSafeHttpsUrl(args.link.url) ? args.link : null
  const webMeta = buttons.length || link ? { ...(buttons.length ? { buttons } : {}), ...(link ? { link } : {}) } : undefined

  const row = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: args.senderType,
      sender_id: args.senderId ?? null,
      content_type: args.contentType ?? (buttons.length ? 'interactive' : 'text'),
      content_text: args.text,
      media_url: media?.url ?? null,
      media_mime_type: media?.mimeType ?? null,
      media_filename: media?.filename ?? null,
      message_id: outboundId(),
      reply_to_message_id: args.replyToMessageId ?? null,
      status: 'delivered',
      ...(webMeta ? { web_meta: webMeta as unknown as Prisma.InputJsonValue } : {}),
    },
  })

  const lastMessageAt = new Date()
  const preview = args.text || (media ? '[Attachment]' : '')
  const updated = await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: lastMessageAt },
  })
  emitToAccount(args.accountId, 'message', { eventType: 'INSERT', new: row, old: {} })
  emitToAccount(args.accountId, 'conversation', { eventType: 'UPDATE', new: updated, old: {} })

  const visible = toVisitorMessage(row)
  if (visible) pushVisitorMessage(args.conversationId, visible)
  return row
}
