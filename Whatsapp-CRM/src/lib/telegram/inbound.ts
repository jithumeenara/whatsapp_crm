/**
 * A Telegram update, from the webhook to everything that acts on it.
 *
 * The same steps, in the same order, as WhatsApp and the website chat:
 * store the message, tell the Inbox, offer it to the chatbots, then to
 * automations, and only if neither wanted it, to the assistant.
 *
 * What Telegram adds:
 *  - Identity is the Telegram user id (contacts.telegram_id). A phone
 *    number is only ever the one the customer shared with Telegram's
 *    "Share my number" button — verified by Telegram, and only taken when
 *    it is their own account's. Then the Telegram contact joins the
 *    WhatsApp contact with that number, if there is one.
 *  - A start link (t.me/<bot>?start=<signed payload>) names a known
 *    contact; the Telegram chat joins that contact.
 *  - Telegram Business chats (the business's own account) carry a
 *    connection id that every reply must go back through.
 */

import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { isContactBlocked, checkForFlood } from '@/lib/whatsapp/spam-guard'
import { shouldReleaseOnReturn } from '@/lib/agents/presence'
import { autoReplyToMessage } from '@/lib/ai/auto-reply'
import { autoCreateLead } from '@/lib/leads/auto-create'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { mergeContacts } from '@/lib/contacts/merge'
import { handleAdminChatInbound } from '@/lib/admin-chat/engine'
import { answerCallbackQuery, fileDownloadUrl, tgCall } from './api'
import { toTelegramHtml } from './format'
import { buttonFor, isLegacyStartPayload, verifyStartPayload } from './links'
import { displayName, mediaLabel, parseUpdate, type TelegramEvent, type TelegramUser } from './parse'
import { startLinkSecret, TELEGRAM_CHANNEL, type LiveBot } from './store'
import { sendToTelegram } from './outbound'

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 }

/** The contact fields the Inbox list and contact panel use (as /api/conversations sends them). */
const CONTACT_FOR_INBOX = {
  id: true, name: true, phone: true, avatar_url: true, email: true, company: true, created_at: true,
  detected_language: true, alternate_phone: true, preferred_language: true, telegram_id: true,
} as const

export function telegramPlaceholderPhone(telegramId: string): string {
  return `tg:${telegramId}`
}

interface Thread {
  contactId: string
  conversationId: string
  contactCreated: boolean
}

/** The customer's contact and conversation, created on first use —
 *  serialised per Telegram user so two updates at once cannot both create. */
async function ensureThread(bot: LiveBot, user: TelegramUser, businessConnectionId: string | null): Promise<Thread> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`telegram:${bot.accountId}:${user.id}`}))`
    let contactCreated = false
    let contact = await tx.contact.findFirst({
      where: { account_id: bot.accountId, telegram_id: user.id },
      select: { id: true, merged_into_contact_id: true },
    })
    // A merged contact's chat belongs to the one it was merged into.
    for (let hop = 0; contact?.merged_into_contact_id && hop < 5; hop++) {
      contact = await tx.contact.findFirst({ where: { id: contact.merged_into_contact_id, account_id: bot.accountId }, select: { id: true, merged_into_contact_id: true } })
    }
    if (!contact) {
      contact = await tx.contact.create({
        data: {
          account_id: bot.accountId,
          user_id: bot.userId,
          phone: telegramPlaceholderPhone(user.id),
          telegram_id: user.id,
          name: displayName(user),
          opt_in_status: 'opted_in',
          opt_in_source: 'telegram',
          opt_in_at: new Date(),
        },
        select: { id: true, merged_into_contact_id: true },
      })
      contactCreated = true
    }
    let conversation = await tx.conversation.findFirst({
      where: { account_id: bot.accountId, contact_id: contact.id, channel: TELEGRAM_CHANNEL },
      select: { id: true, telegram_business_connection_id: true },
    })
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: { account_id: bot.accountId, user_id: bot.userId, contact_id: contact.id, channel: TELEGRAM_CHANNEL, telegram_business_connection_id: businessConnectionId },
        select: { id: true, telegram_business_connection_id: true },
      })
    } else if (businessConnectionId !== conversation.telegram_business_connection_id) {
      // The customer now writes to the bot directly, or to the business's
      // account: replies follow the way they last came in.
      await tx.conversation.update({ where: { id: conversation.id }, data: { telegram_business_connection_id: businessConnectionId } })
    }
    return { contactId: contact.id, conversationId: conversation.id, contactCreated }
  }, TX_OPTIONS)
}

/** Joins the Telegram contact to an existing contact (kept). Never throws. */
async function joinTo(bot: LiveBot, telegramContactId: string, keepId: string): Promise<boolean> {
  if (telegramContactId === keepId) return true
  try {
    await mergeContacts({ accountId: bot.accountId, userId: bot.userId, survivorId: keepId, mergedId: telegramContactId })
    return true
  } catch (err) {
    console.warn('[telegram] could not join contacts:', err instanceof Error ? err.message : err)
    return false
  }
}

/** The customer shared their own Telegram number: keep it, or join the
 *  contact that already has it. Returns the contact id the chat now has. */
async function takeVerifiedNumber(bot: LiveBot, contactId: string, phone: string): Promise<string> {
  const digits = normalizePhone(phone)
  if (!digits || digits.length < 10) return contactId
  const existing = await findExistingContact(bot.accountId, digits).catch(() => null)
  if (existing && existing.id !== contactId) {
    return (await joinTo(bot, contactId, existing.id)) ? existing.id : contactId
  }
  const current = await prisma.contact.findFirst({ where: { id: contactId, account_id: bot.accountId }, select: { phone: true } })
  if (current?.phone?.startsWith('tg:')) {
    await prisma.contact.update({ where: { id: contactId }, data: { phone: digits, phone_normalized: digits } }).catch((err) => {
      console.warn('[telegram] could not save the shared number:', err instanceof Error ? err.message : err)
    })
  }
  return contactId
}

export async function handleTelegramUpdate(bot: LiveBot, raw: unknown): Promise<{ handled: boolean; reason?: string }> {
  const event = parseUpdate(raw)
  await prisma.telegramBot.update({ where: { id: bot.id }, data: { last_update_at: new Date() } }).catch(() => {})

  if (event.kind === 'ignored') return { handled: false, reason: event.reason }
  if (event.kind === 'business_connection') {
    await rememberBusinessConnection(bot, event)
    return { handled: true }
  }
  if (event.kind === 'button') {
    await answerCallbackQuery(bot.token, event.callbackQueryId).catch(() => {})
    return handleButton(bot, event)
  }
  // Admin Chat first (private chats with the bot itself, text only): an
  // enrolled admin's keyword, code or question never becomes a contact.
  const voice = event.media && (event.media.kind === 'voice' || event.media.kind === 'audio') ? event.media : null
  if ((event.text && !event.media) || voice) {
    if (event.businessConnectionId || event.contact) return handleMessage(bot, event)
    const consumed = await handleAdminChatInbound({
      accountId: bot.accountId,
      channel: 'telegram',
      senderKey: event.from.id,
      text: voice ? '' : event.text,
      messageKey: `tg:${event.chatId}:${event.messageId}`,
      // protect_content: no forwarding or saving of what Admin Chat says.
      reply: async (text) => {
        await tgCall(bot.token, 'sendMessage', { chat_id: event.chatId, text: toTelegramHtml(text), parse_mode: 'HTML', protect_content: true })
      },
      forgetCodeMessage: async () => {
        await tgCall(bot.token, 'deleteMessage', { chat_id: event.chatId, message_id: event.messageId })
      },
      ...(voice
        ? {
            audio: async () => {
              const { url } = await fileDownloadUrl(bot.token, voice.fileId)
              const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
              if (!res.ok) throw new Error(`Telegram file download ${res.status}`)
              return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: voice.mimeType || 'audio/ogg' }
            },
          }
        : {}),
      replyVoice: async (mp3) => {
        const form = new FormData()
        form.append('chat_id', event.chatId)
        form.append('audio', new Blob([new Uint8Array(mp3)], { type: 'audio/mpeg' }), 'reply.mp3')
        form.append('protect_content', 'true')
        await tgCall(bot.token, 'sendAudio', form)
      },
    }).catch((err) => {
      console.error('[admin-chat] telegram handling failed:', err)
      return false
    })
    if (consumed) return { handled: true, reason: 'admin_chat' }
  }
  return handleMessage(bot, event)
}

async function rememberBusinessConnection(bot: LiveBot, event: Extract<TelegramEvent, { kind: 'business_connection' }>) {
  const row = await prisma.telegramBot.findUnique({ where: { id: bot.id }, select: { business_connections: true } })
  const list = (Array.isArray(row?.business_connections) ? row!.business_connections : []) as Array<Record<string, unknown>>
  const entry = { id: event.connectionId, user_id: event.user.id, user_name: displayName(event.user), enabled: event.enabled, connected_at: new Date().toISOString() }
  const next = [...list.filter((c) => c.id !== event.connectionId), entry].slice(-10)
  await prisma.telegramBot.update({ where: { id: bot.id }, data: { business_connections: next as unknown as Prisma.InputJsonValue } })
}

async function storeInbound(args: {
  bot: LiveBot
  thread: Thread
  key: string
  text: string
  contentType: string
  replyId?: string | null
  media?: { fileId: string; mimeType: string | null; fileName: string | null } | null
}): Promise<{ row: Awaited<ReturnType<typeof prisma.message.create>>; duplicate: boolean }> {
  return prisma.$transaction(async (tx) => {
    const already = await tx.message.findFirst({ where: { conversation_id: args.thread.conversationId, message_id: args.key } })
    if (already) return { row: already, duplicate: true }
    const id = crypto.randomUUID()
    const row = await tx.message.create({
      data: {
        id,
        conversation_id: args.thread.conversationId,
        sender_type: 'customer',
        content_type: args.contentType,
        content_text: args.text,
        message_id: args.key,
        interactive_reply_id: args.replyId ?? null,
        status: 'delivered',
        ...(args.media
          ? {
              // Served through the CRM: a Telegram file URL carries the bot token.
              media_url: `/api/telegram/media/${id}`,
              media_mime_type: args.media.mimeType,
              media_filename: args.media.fileName,
              telegram_meta: { file_id: args.media.fileId } as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    })
    return { row, duplicate: false }
  }, TX_OPTIONS)
}

async function handleMessage(bot: LiveBot, event: Extract<TelegramEvent, { kind: 'message' }>) {
  let thread = await ensureThread(bot, event.from, event.businessConnectionId)
  const key = `tg:${event.chatId}:${event.messageId}${event.businessConnectionId ? ':b' : ''}`

  // A signed start link: this chat belongs to a contact we already know.
  if (event.startPayload) {
    const known = verifyStartPayload(event.startPayload, startLinkSecret(bot.accountId))
    if (known) {
      const target = await prisma.contact.findFirst({
        where: { id: known, account_id: bot.accountId },
        select: { id: true, telegram_id: true },
      })
      // A contact already on another Telegram account is never taken over
      // by somebody who got hold of its link; an old (non-expiring) link
      // only ever claims a contact with no Telegram yet.
      const sender = String(event.from.id)
      const free = !target?.telegram_id || target.telegram_id === sender
      const allowed = target && (isLegacyStartPayload(event.startPayload) ? !target.telegram_id : free)
      if (target && !allowed) console.warn(`[telegram] start link for a contact already on another Telegram account — not joined`)
      if (target && allowed && (await joinTo(bot, thread.contactId, target.id))) thread = { ...thread, contactId: target.id, contactCreated: false }
    }
  }

  // Telegram's verified number, when it is the customer's own.
  if (event.contact?.ownNumber) {
    const kept = await takeVerifiedNumber(bot, thread.contactId, event.contact.phone)
    thread = { ...thread, contactId: kept, contactCreated: kept === thread.contactId ? thread.contactCreated : false }
  }

  const isStart = event.startPayload !== null
  const text = event.contact
    ? event.contact.ownNumber ? '[Shared their phone number]' : '[Shared a contact]'
    : event.text || (event.media ? mediaLabel(event.media.kind) : '')
  const contentType = event.media ? (event.media.kind === 'voice' ? 'audio' : event.media.kind === 'sticker' ? 'image' : event.media.kind) : 'text'
  const stored = await storeInbound({
    bot, thread, key, text, contentType,
    media: event.media ? { fileId: event.media.fileId, mimeType: event.media.mimeType, fileName: event.media.fileName } : null,
  })
  if (stored.duplicate) return { handled: true, reason: 'duplicate' }
  emitToAccount(bot.accountId, 'message', { eventType: 'INSERT', new: stored.row, old: {} })

  if (event.contact?.ownNumber) {
    await sendToTelegram({ accountId: bot.accountId, conversationId: thread.conversationId, senderType: 'bot', text: 'Thank you — your number is saved.' }).catch(() => {})
  }
  // "/start" is a greeting, not a question: chatbots and the assistant see "Hi".
  await react(bot, thread, { text: isStart ? 'Hi' : event.contact ? '' : event.text, key, stored: text })
  return { handled: true }
}

async function handleButton(bot: LiveBot, event: Extract<TelegramEvent, { kind: 'button' }>) {
  const thread = await ensureThread(bot, event.from, event.businessConnectionId)
  // The buttons that message carried, to turn a hashed id back into the reply id.
  const sent = event.messageId
    ? await prisma.message.findFirst({
        where: { conversation_id: thread.conversationId, message_id: { startsWith: `tg:${event.chatId}:${event.messageId}` } },
        select: { telegram_meta: true },
      })
    : null
  const meta = (sent?.telegram_meta ?? {}) as { buttons?: Array<{ id: string; title: string; cb: string }> }
  const reply = buttonFor(event.data, meta.buttons ?? [])
  if (!reply) return { handled: false, reason: 'unknown button' }
  const key = `tg:cb:${event.callbackQueryId}`
  const stored = await storeInbound({ bot, thread, key, text: reply.title, contentType: 'interactive', replyId: reply.id })
  if (stored.duplicate) return { handled: true, reason: 'duplicate' }
  emitToAccount(bot.accountId, 'message', { eventType: 'INSERT', new: stored.row, old: {} })
  await react(bot, thread, { text: reply.title, key, stored: reply.title, reply })
  return { handled: true }
}

async function react(bot: LiveBot, thread: Thread, msg: { text: string; key: string; stored: string; reply?: { id: string; title: string } }) {
  const accountId = bot.accountId
  const conversation = await prisma.conversation.findUnique({ where: { id: thread.conversationId } })
  if (!conversation) return

  let releaseOwner = false
  if (conversation.status === 'closed' && conversation.assigned_agent_id) {
    const owner = await prisma.user.findUnique({ where: { id: conversation.assigned_agent_id }, select: { last_seen_at: true, went_offline_at: true } }).catch(() => null)
    releaseOwner = owner ? shouldReleaseOnReturn(owner) : false
  }
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      last_message_text: msg.stored,
      last_message_at: new Date(),
      unread_count: { increment: 1 },
      ...(conversation.status === 'closed' ? { status: 'open' } : {}),
      ...(releaseOwner ? { assigned_agent_id: null } : {}),
    },
    // The contact rides along: a shared number or a join with a known
    // contact shows in the open Inbox at once, without a reload.
    include: { contact: { select: CONTACT_FOR_INBOX } },
  })
  emitToAccount(accountId, 'conversation', { eventType: 'UPDATE', new: updated, old: {} })

  if (thread.contactCreated) {
    const contact = await prisma.contact.findUnique({ where: { id: thread.contactId }, select: { name: true } }).catch(() => null)
    await autoCreateLead({ accountId, userId: bot.userId, contactId: thread.contactId, title: contact?.name || 'Telegram contact', source: TELEGRAM_CHANNEL })
  }

  const block = await isContactBlocked(thread.contactId).catch(() => ({ blocked: false as const }))
  if (block.blocked) return
  if (await checkForFlood({ contactId: thread.contactId, conversationId: conversation.id }).catch(() => false)) return
  if (!msg.text && !msg.reply) return

  const priorInbound = await prisma.message.count({ where: { conversation_id: conversation.id, sender_type: 'customer' } })
  const isFirstInboundMessage = priorInbound <= 1

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: bot.userId,
    contactId: thread.contactId,
    conversationId: conversation.id,
    channel: TELEGRAM_CHANNEL,
    message: msg.reply
      ? { kind: 'interactive_reply', reply_id: msg.reply.id, reply_title: msg.reply.title, meta_message_id: msg.key }
      : { kind: 'text', text: msg.text, meta_message_id: msg.key },
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
      context: { message_text: msg.text, conversation_id: conversation.id },
    }).catch((err) => {
      console.error('[automations] dispatch failed:', err)
      return { matched: 0 }
    })
    if (triggerType === 'new_message_received' || triggerType === 'keyword_match') automationsMatched += result.matched
  }
  if (flowResult.consumed || automationsMatched > 0) return

  const outcome = await autoReplyToMessage({
    accountId,
    userId: bot.userId,
    conversationId: conversation.id,
    contactId: thread.contactId,
    message: msg.text,
    channel: TELEGRAM_CHANNEL,
  })
  if (outcome !== 'replied' && outcome !== 'handed_off') console.warn(`[ai-auto-reply] no reply sent on ${conversation.id}: ${outcome}`)
}
