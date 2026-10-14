/**
 * A website visitor's message, from the HTTP route to everything that
 * acts on it.
 *
 * The same steps, in the same order, as an inbound WhatsApp or RCS
 * message: store it, tell the Inbox, offer it to the chatbots, then to
 * automations, and only if neither wanted it, to the assistant. Website
 * chat is one more channel on the existing machinery, not a second
 * machine — the Inbox, the chatbot builder and the assistant need to
 * know nothing about it beyond its name.
 *
 * Two things are different, because a website is not a phone network:
 *
 *   - Nobody has proved who the visitor is. Their contact is created on
 *     the first message (not on opening the window, so looking is not
 *     enough to become a record), and the assistant's write tools are
 *     withheld from them — see `anonymous` in customer-tools.ts.
 *   - Anybody can be a visitor, including a script. Each account has a
 *     daily ceiling on assistant replies to website chats, so a flood
 *     costs at most that and then waits for the team.
 */

import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { isContactBlocked, checkForFlood } from '@/lib/whatsapp/spam-guard'
import { shouldReleaseOnReturn } from '@/lib/agents/presence'
import { autoReplyToMessage, handOver, AI_AUTO_REPLY_SOURCE } from '@/lib/ai/auto-reply'
import { sendHandoffAlert } from '@/lib/ai/handoff-alert'
import { autoCreateLead } from '@/lib/leads/auto-create'
import { leadForHandoff } from '@/lib/leads/handoff-lead'
import { visitorPhone } from './tokens'
import type { AuthenticatedSession } from './session'
import { toVisitorMessage, type VisitorMessage } from './public-message'
import { joinConversationRoom, pushVisitorMessage, pushVisitorTyping, pushVisitorStatus } from './realtime'

export const WEBSITE_CHANNEL = 'website'

/** "Visitor QKXM" — something to call them by until they give a name,
 *  distinct enough to tell two apart in the Inbox. */
function visitorName(visitorId: string): string {
  return `Visitor ${visitorId.slice(0, 4).toUpperCase()}`
}

/** Prisma's 5-second default is shorter than a cold start or a busy
 *  database can take, and a visitor's first message must not fail for
 *  it. Each transaction is a handful of indexed queries. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

interface Thread {
  contactId: string
  conversationId: string
  contactCreated: boolean
}

/**
 * The visitor's contact and conversation, created on first use.
 *
 * Serialised per session with a transaction-scoped advisory lock: two
 * tabs sending their first message at the same moment would otherwise
 * both find nothing and both create, and the conversation's unique key
 * cannot stop that (its whatsapp_config_id is NULL here, and NULLs are
 * distinct). The lock is released when the transaction ends.
 */
async function ensureThread(session: AuthenticatedSession): Promise<Thread> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`webchat:${session.id}`}))`

    const current = await tx.webChatSession.findUnique({
      where: { id: session.id },
      select: { contact_id: true, conversation_id: true },
    })

    let contactCreated = false
    let contactId = current?.contact_id ?? null
    if (contactId) {
      const exists = await tx.contact.findFirst({ where: { id: contactId, account_id: session.account_id }, select: { id: true } })
      if (!exists) contactId = null
    }
    if (!contactId) {
      const existing = await tx.contact.findFirst({
        where: { account_id: session.account_id, web_visitor_id: session.visitor_id },
        select: { id: true },
      })
      if (existing) {
        contactId = existing.id
      } else {
        const created = await tx.contact.create({
          data: {
            account_id: session.account_id,
            user_id: session.widget.user_id,
            phone: visitorPhone(session.visitor_id),
            web_visitor_id: session.visitor_id,
            name: visitorName(session.visitor_id),
            opt_in_status: 'opted_in',
            opt_in_source: 'website_chat',
            opt_in_at: new Date(),
          },
          select: { id: true },
        })
        contactId = created.id
        contactCreated = true
      }
    }

    let conversationId = current?.conversation_id ?? null
    if (conversationId) {
      const exists = await tx.conversation.findFirst({
        where: { id: conversationId, account_id: session.account_id, contact_id: contactId },
        select: { id: true },
      })
      if (!exists) conversationId = null
    }
    if (!conversationId) {
      const existing = await tx.conversation.findFirst({
        where: { account_id: session.account_id, contact_id: contactId, channel: WEBSITE_CHANNEL },
        select: { id: true },
      })
      conversationId =
        existing?.id ??
        (
          await tx.conversation.create({
            data: {
              account_id: session.account_id,
              user_id: session.widget.user_id,
              contact_id: contactId,
              channel: WEBSITE_CHANNEL,
            },
            select: { id: true },
          })
        ).id
    }

    if (current?.contact_id !== contactId || current?.conversation_id !== conversationId) {
      await tx.webChatSession.update({
        where: { id: session.id },
        data: { contact_id: contactId, conversation_id: conversationId },
      })
    }
    return { contactId, conversationId, contactCreated }
  }, TX_OPTIONS)

  if (session.conversation_id !== result.conversationId) {
    joinConversationRoom(session.id, result.conversationId)
  }
  return result
}

export type ReceiveResult =
  | { ok: true; message: VisitorMessage; duplicate: boolean }
  | { ok: false; status: number; error: string }

/**
 * Store one message from the visitor and set everything after it going.
 *
 * Idempotent on `clientMessageId`: the window sends the same id when it
 * retries after a dropped connection, and the second arrival returns the
 * first one's message instead of storing — and answering — it twice.
 */
export async function receiveVisitorMessage(args: {
  session: AuthenticatedSession
  text: string
  clientMessageId: string
  /** A chatbot button or list row the visitor tapped. */
  reply?: { id: string; title: string }
}): Promise<ReceiveResult> {
  const { session } = args
  const thread = await ensureThread(session)
  const key = `web:${session.id}:${args.clientMessageId}`

  // The duplicate check and the insert under one lock, so a retry that
  // arrives while the first is still being stored cannot slip between.
  const stored = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`webchat:msg:${session.id}`}))`
    const already = await tx.message.findFirst({
      where: { conversation_id: thread.conversationId, message_id: key },
    })
    if (already) return { row: already, duplicate: true }
    const row = await tx.message.create({
      data: {
        conversation_id: thread.conversationId,
        sender_type: 'customer',
        content_type: args.reply ? 'interactive' : 'text',
        content_text: args.text,
        message_id: key,
        interactive_reply_id: args.reply?.id ?? null,
        status: 'delivered',
      },
    })
    return { row, duplicate: false }
  }, TX_OPTIONS)

  const visible = toVisitorMessage(stored.row)
  if (!visible) return { ok: false, status: 500, error: 'Could not store the message.' }
  if (stored.duplicate) return { ok: true, message: visible, duplicate: true }

  emitToAccount(session.account_id, 'message', { eventType: 'INSERT', new: stored.row, old: {} })
  // Other tabs of the same visitor show it too.
  pushVisitorMessage(thread.conversationId, visible)

  // Everything below is the reaction to the message, not the receipt of
  // it: the visitor's request returns as soon as it is stored.
  void react({ session, thread, text: args.text, reply: args.reply, messageKey: key }).catch((err) =>
    console.error('[webchat] processing failed:', err instanceof Error ? err.message : err),
  )
  return { ok: true, message: visible, duplicate: false }
}

async function react(args: {
  session: AuthenticatedSession
  thread: Thread
  text: string
  reply?: { id: string; title: string }
  messageKey: string
}): Promise<void> {
  const { session, thread } = args
  const accountId = session.account_id
  const userId = session.widget.user_id

  const conversation = await prisma.conversation.findUnique({ where: { id: thread.conversationId } })
  if (!conversation) return

  // A customer writing again reopens a closed thread — and hands it back
  // to the team if whoever had it has gone. Same rule as WhatsApp.
  let releaseOwner = false
  if (conversation.status === 'closed' && conversation.assigned_agent_id) {
    const owner = await prisma.user
      .findUnique({ where: { id: conversation.assigned_agent_id }, select: { last_seen_at: true, went_offline_at: true } })
      .catch(() => null)
    releaseOwner = owner ? shouldReleaseOnReturn(owner) : false
  }
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      last_message_text: args.text,
      last_message_at: new Date(),
      unread_count: { increment: 1 },
      ...(conversation.status === 'closed' ? { status: 'open' } : {}),
      ...(releaseOwner ? { assigned_agent_id: null } : {}),
    },
  })
  emitToAccount(accountId, 'conversation', { eventType: 'UPDATE', new: updated, old: {} })

  // A brand-new visitor becomes a lead, as a new WhatsApp customer does
  // (when the account has auto lead creation on). Named "Visitor ABCD"
  // until the welcome chatbot or the assistant learns their name — the
  // title follows it then (update-field.ts).
  if (thread.contactCreated) {
    const contact = await prisma.contact.findUnique({ where: { id: thread.contactId }, select: { name: true } }).catch(() => null)
    await autoCreateLead({
      accountId,
      userId,
      contactId: thread.contactId,
      title: contact?.name || 'Website visitor',
      source: WEBSITE_CHANNEL,
    })
  }

  // Blocked or flooding: stored for whoever reviews it, acted on by nothing.
  const block = await isContactBlocked(thread.contactId).catch(() => ({ blocked: false as const }))
  if (block.blocked) return
  if (await checkForFlood({ contactId: thread.contactId, conversationId: conversation.id }).catch(() => false)) return

  const priorInbound = await prisma.message.count({
    where: { conversation_id: conversation.id, sender_type: 'customer' },
  })
  const isFirstInboundMessage = priorInbound <= 1

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId,
    contactId: thread.contactId,
    conversationId: conversation.id,
    channel: WEBSITE_CHANNEL,
    message: args.reply
      ? { kind: 'interactive_reply', reply_id: args.reply.id, reply_title: args.reply.title, meta_message_id: args.messageKey }
      : { kind: 'text', text: args.text, meta_message_id: args.messageKey },
    isFirstInboundMessage,
  })

  const triggers: ('new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match')[] = []
  if (thread.contactCreated) triggers.push('new_contact_created')
  if (isFirstInboundMessage) triggers.push('first_inbound_message')
  if (!flowResult.consumed) triggers.push('new_message_received', 'keyword_match')
  let automationsMatched = 0
  for (const triggerType of triggers) {
    const result = await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: thread.contactId,
      context: { message_text: args.text, conversation_id: conversation.id },
    }).catch((err) => {
      console.error('[automations] dispatch failed:', err)
      return { matched: 0 }
    })
    if (triggerType === 'new_message_received' || triggerType === 'keyword_match') automationsMatched += result.matched
  }

  if (flowResult.consumed || automationsMatched > 0) return

  // The daily ceiling. Counted across the account's website chats, which
  // is where a flood would land; WhatsApp and the rest are unaffected.
  const startOfDay = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const repliesToday = await prisma.message.count({
    where: {
      bot_source: AI_AUTO_REPLY_SOURCE,
      created_at: { gte: startOfDay },
      conversation: { account_id: accountId, channel: WEBSITE_CHANNEL },
    },
  })
  if (repliesToday >= session.widget.daily_ai_limit) {
    console.warn(`[webchat] daily assistant limit (${session.widget.daily_ai_limit}) reached for account ${accountId}; left for the team`)
    return
  }

  pushVisitorTyping(conversation.id, true)
  try {
    const outcome = await autoReplyToMessage({
      accountId,
      userId,
      conversationId: conversation.id,
      contactId: thread.contactId,
      message: args.text,
      channel: WEBSITE_CHANNEL,
    })
    if (outcome === 'replied' || outcome === 'handed_off') {
      console.log(`[ai-auto-reply] ${outcome} on ${conversation.id}`)
    } else {
      console.warn(`[ai-auto-reply] no reply sent on ${conversation.id}: ${outcome}`)
    }
    if (outcome === 'handed_off') {
      pushVisitorStatus(conversation.id, { status: 'pending', with_team: true })
    }
  } finally {
    pushVisitorTyping(conversation.id, false)
  }
}

/**
 * The visitor pressed "Talk to a person".
 *
 * The same handover the assistant makes — Pending, an internal note, the
 * team's alert if the account has one — so the queue picks it up without
 * a website-specific rule. Pressing it twice does nothing new.
 */
export async function requestHuman(session: AuthenticatedSession): Promise<{ conversationId: string }> {
  const thread = await ensureThread(session)
  const conversation = await prisma.conversation.findUnique({
    where: { id: thread.conversationId },
    select: { status: true },
  })
  if (conversation?.status !== 'pending') {
    await handOver({
      accountId: session.account_id,
      conversationId: thread.conversationId,
      note: 'The visitor asked to talk to a person, from the website chat window.',
    })
    void sendHandoffAlert({
      accountId: session.account_id,
      conversationId: thread.conversationId,
      reason: 'customer_requested',
      customerMessage: 'Asked to talk to a person (website chat)',
      contact: await prisma.contact
        .findUnique({ where: { id: thread.contactId }, select: { name: true, phone: true } })
        .catch(() => null),
    })
    // Asking for a person is an enquiry said out loud: a lead in New
    // Pool, announced to the team (or a push to whoever owns it).
    await leadForHandoff({
      accountId: session.account_id,
      userId: session.widget.user_id,
      contactId: thread.contactId,
      source: WEBSITE_CHANNEL,
      conversationId: thread.conversationId,
    })
  }
  pushVisitorStatus(thread.conversationId, { status: 'pending', with_team: true })
  return { conversationId: thread.conversationId }
}
