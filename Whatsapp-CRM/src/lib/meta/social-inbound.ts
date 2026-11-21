/**
 * Messenger / Instagram webhook events besides a new customer message:
 * reactions, edits, deletes, replies typed in the Instagram / Messenger
 * app itself (echoes) and Meta Business AI hand-overs. Shared by both
 * webhooks so they behave the same. Everything is scoped to the
 * conversation it belongs to; nothing here trusts an id alone.
 */

import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'

const ECHO_GRACE_MS = process.env.VITEST ? 0 : 4000

/** Our message row for a Meta message id, in this conversation only. */
async function rowFor(conversationId: string, mid: string): Promise<{ id: string } | null> {
  if (!mid) return null
  return prisma.message.findFirst({ where: { conversation_id: conversationId, message_id: mid }, select: { id: true } })
}

/**
 * The message a customer replied to (Meta's reply_to.mid), as our row id —
 * looked up in this conversation only, so a reply can never point at a
 * message in someone else's chat. Null when unknown.
 */
export async function replyTargetId(conversationId: string, mid: unknown): Promise<string | null> {
  if (typeof mid !== 'string' || !mid || mid.length > 300) return null
  const row = await rowFor(conversationId, mid).catch(() => null)
  return row?.id ?? null
}

/** A customer reacted (or removed a reaction) to one of the messages. */
export async function applySocialReaction(input: {
  accountId: string; conversationId: string; contactId: string; targetMid: string; emoji: string | null
}): Promise<void> {
  const target = await rowFor(input.conversationId, input.targetMid)
  if (!target) return
  try {
    if (!input.emoji) {
      await prisma.messageReaction.deleteMany({ where: { message_id: target.id, actor_type: 'customer', actor_id: input.contactId } })
    } else {
      const emoji = [...input.emoji].slice(0, 4).join('')
      await prisma.messageReaction.upsert({
        where: { message_id_actor_type_actor_id: { message_id: target.id, actor_type: 'customer', actor_id: input.contactId } },
        create: { message_id: target.id, conversation_id: input.conversationId, actor_type: 'customer', actor_id: input.contactId, emoji },
        update: { emoji },
      })
    }
    emitToAccount(input.accountId, 'message_reaction', { message_id: target.id, conversation_id: input.conversationId })
  } catch (err) {
    console.error('[social inbound] reaction failed:', err instanceof Error ? err.message : err)
  }
}

/** One of the customer's own messages (edits / unsends never touch staff or bot replies). */
async function customerRowFor(conversationId: string, mid: string): Promise<{ id: string } | null> {
  if (!mid) return null
  return prisma.message.findFirst({ where: { conversation_id: conversationId, message_id: mid, sender_type: 'customer' }, select: { id: true } })
}

/** The customer edited a message: the new text replaces the old one. */
export async function applySocialEdit(input: { accountId: string; conversationId: string; mid: string; text: string }): Promise<void> {
  const target = await customerRowFor(input.conversationId, input.mid)
  if (!target) return
  const updated = await prisma.message.update({
    where: { id: target.id },
    data: { content_text: input.text.slice(0, 4000) },
  }).catch(() => null)
  if (updated) emitToAccount(input.accountId, 'message', { eventType: 'UPDATE', new: updated, old: {} })
}

/** The customer unsent a message: kept for the record, shown as deleted. */
export async function applySocialDelete(input: { accountId: string; conversationId: string; mid: string }): Promise<void> {
  const target = await customerRowFor(input.conversationId, input.mid)
  if (!target) return
  const updated = await prisma.message.update({ where: { id: target.id }, data: { deleted_at: new Date() } }).catch(() => null)
  if (updated) emitToAccount(input.accountId, 'message', { eventType: 'UPDATE', new: updated, old: {} })
}

/**
 * A reply the business typed in the Instagram / Messenger app (an echo).
 * Replies this CRM sent are already saved under the same Meta id, so they
 * are skipped; anything else is added so the Inbox shows the whole chat.
 */
export async function saveSocialEcho(input: {
  accountId: string; conversationId: string; mid: string; text: string | null; mediaUrl: string | null; contentType: string; at: Date
}): Promise<boolean> {
  if (!input.mid) return false
  if (await rowFor(input.conversationId, input.mid)) return false
  // The echo of a reply this CRM just sent can arrive before the CRM has
  // saved that reply (it saves after Meta answers). Wait briefly, look again.
  // The webhooks process events after answering Meta, so this blocks nothing.
  await new Promise((r) => setTimeout(r, ECHO_GRACE_MS))
  if (await rowFor(input.conversationId, input.mid)) return false
  const saved = await prisma.message.create({
    data: {
      conversation_id: input.conversationId,
      sender_type: 'agent',
      sender_id: null,
      bot_source: 'native_app',
      content_type: input.contentType,
      content_text: input.text ?? (input.mediaUrl ? `[${input.contentType}]` : null),
      media_url: input.mediaUrl,
      message_id: input.mid,
      status: 'sent',
      created_at: input.at,
    },
  }).catch(() => null)
  if (!saved) return false
  emitToAccount(input.accountId, 'message', { eventType: 'INSERT', new: saved, old: {} })
  return true
}

const HANDOFF_WORDS: Record<string, string> = {
  purchase_intent: 'the customer wants to buy',
  payment_received: 'a payment was received',
  human_requested: 'the customer asked for a person',
  other: 'another reason',
}

/** Meta Business AI handed the chat to the team: a note in the thread. */
export async function noteBusinessAiHandoff(input: { accountId: string; conversationId: string; reason: string | null; adminText: string | null }): Promise<void> {
  const why = input.reason ? HANDOFF_WORDS[input.reason] ?? input.reason.slice(0, 60) : null
  const text = `Meta Business AI handed this chat to your team${why ? ` — ${why}` : ''}.${input.adminText ? ` ${input.adminText.slice(0, 300)}` : ''}`
  const saved = await prisma.message.create({
    data: { conversation_id: input.conversationId, sender_type: 'system', content_type: 'text', content_text: text, status: 'sent' },
  }).catch(() => null)
  if (saved) emitToAccount(input.accountId, 'message', { eventType: 'INSERT', new: saved, old: {} })
}

/** Every attachment of a message, typed for our Inbox (Meta now sends several images at once). */
export function attachmentsToRows(attachments: Array<{ type?: string; payload?: { url?: string } }> | undefined): Array<{ contentType: string; url: string | null; label: string }> {
  return (attachments ?? []).slice(0, 30).map((a) => {
    const t = a?.type ?? ''
    const contentType = t === 'image' ? 'image' : t === 'video' ? 'video' : t === 'audio' ? 'audio' : t === 'file' ? 'document' : t === 'story_mention' ? 'image' : 'text'
    const label = t === 'story_mention' ? '[mentioned you in their story]' : t === 'ig_reel' || t === 'reel' ? '[shared a reel]' : t === 'ig_post' || t === 'share' ? '[shared a post]' : `[${t || 'attachment'}]`
    const url = typeof a?.payload?.url === 'string' && /^https:\/\//i.test(a.payload.url) ? a.payload.url : null
    return { contentType, url, label }
  })
}
