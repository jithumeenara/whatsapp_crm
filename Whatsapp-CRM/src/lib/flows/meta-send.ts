import { readFile } from 'fs/promises'
import { basename } from 'path'
import { lookup as mimeLookup } from 'mime-types'
import {
  sendCtaUrlButton,
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  sendFlowMessage,
  uploadMediaToMeta,
  sendCatalogMessage,
  sendSingleProductMessage,
  sendMultiProductMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import { decrypt, openStoredSecret } from '@/lib/whatsapp/encryption'
import { resolveUploadPath } from '@/lib/whatsapp/media-ref'
import { resolveWhatsAppConfig, NoWhatsAppConfigError } from '@/lib/whatsapp/resolve-config'
import { sendSmsText } from '@/lib/messaging/channels/sms'
import { sendConversationEmail } from '@/lib/email/conversation-send'
import { sendRcsText } from '@/lib/messaging/channels/rcs'

import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { prisma } from '@/lib/db'
import { sendToWebsiteVisitor } from '@/lib/webchat/outbound'
import { loadSocialTarget, socialPost, socialSenderAction, type SocialChannel, type SocialTarget } from '@/lib/meta/social-messaging'

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
}

interface SendTemplateEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  languageCode: string
  bodyParams?: string
  /** Named ({{customer_name}}) body values, keyed by name — set INSTEAD of
   *  bodyParams when the template uses Meta's named-parameter format. */
  bodyByName?: Record<string, string>
  /** Header variable value, only used if the template's header type is text with a variable. */
  headerText?: string
  /** Media-header override for this specific send — takes priority over the
   *  template's own header_media_url when set (see SendTimeParams). */
  headerMediaUrl?: string
  /** Per-URL-button variable suffixes, keyed by button index. */
  buttonParams?: Record<number, string>
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  /** Takes priority over headerText when set — Meta allows only one header type. */
  headerMediaUrl?: string
  headerMediaType?: 'image' | 'video' | 'document'
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

interface SendCtaUrlButtonEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  displayText: string
  url: string
  headerText?: string
  footerText?: string
}

async function resolveContactAndConfig(accountId: string, contactId: string, conversationId?: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, account_id: accountId },
    select: { id: true, phone: true },
  })
  if (!contact?.phone) throw new Error('contact not found for this account')

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) throw new Error(`contact phone invalid: ${contact.phone}`)

  // Resolves the specific number this conversation is bound to (Finding
  // #14 — a reply should come from the number that received the thread,
  // not a blind account-wide default), falling back to the account's
  // default number when there's no conversation context.
  let config
  try {
    config = await resolveWhatsAppConfig({ accountId, conversationId })
  } catch (err) {
    if (err instanceof NoWhatsAppConfigError) throw new Error('WhatsApp not configured for this account')
    throw err
  }

  return { contact, sanitized, config }
}

async function retryWithVariants(
  sanitized: string,
  contactId: string,
  attempt: (phone: string) => Promise<string>,
): Promise<{ waMessageId: string }> {
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null

  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await prisma.contact.update({ where: { id: contactId }, data: { phone: workingPhone } })
  }
  return { waMessageId }
}

/**
 * Converts WhatsApp-style markdown to Unicode mathematical characters so
 * formatting is visible in Instagram (which has no native markdown support).
 *   *bold*  → 𝗯𝗼𝗹𝗱   (Mathematical Bold)
 *   _italic_ → 𝑖𝑡𝑎𝑙𝑖𝑐  (Mathematical Italic)
 *   ~strike~ → removed markers (no Unicode strikethrough equivalent)
 */
function convertMarkdownForInstagram(text: string): string {
  const boldChar = (ch: string) => {
    const c = ch.charCodeAt(0)
    if (c >= 0x41 && c <= 0x5A) return String.fromCodePoint(c - 0x41 + 0x1D400)
    if (c >= 0x61 && c <= 0x7A) return String.fromCodePoint(c - 0x61 + 0x1D41A)
    if (c >= 0x30 && c <= 0x39) return String.fromCodePoint(c - 0x30 + 0x1D7CE)
    return ch
  }
  const italicChar = (ch: string) => {
    const c = ch.charCodeAt(0)
    if (c >= 0x41 && c <= 0x5A) return String.fromCodePoint(c - 0x41 + 0x1D434)
    if (c >= 0x61 && c <= 0x7A) return c === 0x68 ? 'ℎ' : String.fromCodePoint(c - 0x61 + 0x1D44E)
    return ch
  }
  return text
    .replace(/\*([^*\n]+)\*/g, (_, s: string) => [...s].map(boldChar).join(''))
    .replace(/_([^_\n]+)_/g,   (_, s: string) => [...s].map(italicChar).join(''))
    .replace(/~([^~\n]+)~/g,   '$1')
}

// ── Messenger + Instagram (shared) ────────────────────────────────────
// Where and to whom: src/lib/meta/social-messaging.ts (host by token type,
// the contact's IGSID/PSID, plain-language Meta errors).

const SOCIAL_LABEL: Record<SocialChannel, string> = { instagram: 'Instagram', facebook: 'Messenger' }

function isSocial(channel: string | null | undefined): channel is SocialChannel {
  return channel === 'instagram' || channel === 'facebook'
}

/** Saves the bot's message, touches the conversation, tells the Inbox. */
async function persistSocialBotMessage(
  args: { accountId: string; conversationId: string },
  row: { contentType: string; text: string; mediaUrl?: string | null; messageId: string },
) {
  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: args.conversationId, sender_type: 'bot', content_type: row.contentType,
      content_text: row.text, ...(row.mediaUrl ? { media_url: row.mediaUrl } : {}), message_id: row.messageId, status: 'sent',
    },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: row.text, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: row.text, last_message_at: lastMessageAt.toISOString() })
}

async function engineSendTextSocial(args: SendTextEngineArgs, channel: SocialChannel): Promise<{ whatsapp_message_id: string }> {
  const target = await loadSocialTarget(args.accountId, args.contactId, channel)
  // Typing indicator first, for a natural feel (never blocks the send).
  await socialSenderAction(target, 'typing_on')
  const text = convertMarkdownForInstagram(args.text)
  const { messageId } = await socialPost(target, {
    recipient: { id: target.recipientId },
    message: { text },
    messaging_type: 'RESPONSE',
  })
  const mid = messageId ?? `${channel === 'instagram' ? 'ig' : 'fb'}_bot_${Date.now()}`
  await persistSocialBotMessage(args, { contentType: 'text', text: args.text, messageId: mid })
  return { whatsapp_message_id: mid }
}

/**
 * Button template, both channels: postback buttons come back as
 * messaging_postbacks with payload = the node's reply id; a web_url button
 * opens the link. At most 3 buttons, 20-character titles, 640-character text.
 */
async function engineSendButtonTemplateSocial(
  args: { accountId: string; contactId: string; conversationId: string },
  channel: SocialChannel,
  text: string,
  buttons: Array<{ type: 'postback'; title: string; payload: string } | { type: 'web_url'; title: string; url: string }>,
): Promise<{ whatsapp_message_id: string }> {
  const target = await loadSocialTarget(args.accountId, args.contactId, channel)
  await socialSenderAction(target, 'typing_on')
  const { messageId } = await socialPost(target, {
    recipient: { id: target.recipientId },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: (text ?? '').slice(0, 640) || 'Choose an option:',
          buttons: buttons.slice(0, 3).map((b) => ({ ...b, title: b.title.slice(0, 20) })),
        },
      },
    },
    messaging_type: 'RESPONSE',
  })
  const mid = messageId ?? `${channel === 'instagram' ? 'ig' : 'fb'}_btn_${Date.now()}`
  await persistSocialBotMessage(args, { contentType: 'text', text, messageId: mid })
  return { whatsapp_message_id: mid }
}

async function notifyBotMessage(
  accountId: string,
  message: unknown,
  conversationId: string,
  conversationPatch: Record<string, unknown>,
) {
  const { emitToAccount } = await import('@/lib/socket')
  emitToAccount(accountId, 'message', { eventType: 'INSERT', new: message, old: {} })
  emitToAccount(accountId, 'conversation', {
    eventType: 'UPDATE',
    new: { id: conversationId, ...conversationPatch },
    old: {},
  })
}

/** Shared persistence for the SMS/Email/RCS channels — mirrors the
 *  message-row + conversation-touch pattern each existing branch below
 *  (WhatsApp, Instagram) already duplicates inline. */
async function persistBotTextMessage(accountId: string, conversationId: string, text: string, messageId: string) {
  const savedMsg = await prisma.message.create({
    data: { conversation_id: conversationId, sender_type: 'bot', content_type: 'text', content_text: text, message_id: messageId, status: 'sent' },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { last_message_text: text, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(accountId, savedMsg, conversationId, { last_message_text: text, last_message_at: lastMessageAt.toISOString() })
}

/** The conversation's channel, read raw so a database whose Prisma
 *  client predates a column still works — same as the senders below. */
async function channelOf(conversationId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  return rows[0]?.channel ?? null
}

// ── Website chat ──────────────────────────────────────────────────────
// No provider: the message is recorded and pushed to the visitor's open
// window (src/lib/webchat/outbound.ts). Buttons and list rows render as
// real buttons there, so a chatbot built for WhatsApp works unchanged.

async function websiteSend(
  args: { accountId: string; conversationId: string },
  content: Omit<Parameters<typeof sendToWebsiteVisitor>[0], 'accountId' | 'conversationId' | 'senderType'>,
): Promise<{ whatsapp_message_id: string }> {
  const row = await sendToWebsiteVisitor({ ...args, senderType: 'bot', ...content })
  return { whatsapp_message_id: row.message_id ?? row.id }
}

// ── Telegram ─────────────────────────────────────────────────────────
// Through the customer's Telegram chat (src/lib/telegram/outbound.ts).
// Buttons and list rows become Telegram's inline buttons, so a chatbot
// built for WhatsApp works unchanged. Loaded lazily: most accounts have
// no Telegram bot.

async function telegramSend(
  args: { accountId: string; conversationId: string },
  content: { text: string; buttons?: Array<{ id: string; title: string }>; media?: { url: string; mimeType?: string | null; filename?: string | null } | null; contentType?: string; link?: { label: string; url: string } | null },
): Promise<{ whatsapp_message_id: string }> {
  const { sendToTelegram } = await import('@/lib/telegram/outbound')
  const row = await sendToTelegram({ accountId: args.accountId, conversationId: args.conversationId, senderType: 'bot', ...content })
  return { whatsapp_message_id: row.message_id ?? row.id }
}

/** WhatsApp-only message kinds have no meaning on these channels. */
function notOnChannel(channel: string | null, what: string): void {
  if (channel === 'website') throw new Error(`${what} cannot be sent to a website chat. Use a text, buttons or list step instead.`)
  if (channel === 'telegram') throw new Error(`${what} cannot be sent on Telegram. Use a text, buttons or list step instead.`)
  if (isSocial(channel)) throw new Error(`${what} cannot be sent on ${SOCIAL_LABEL[channel]}. Use a text, buttons or list step instead.`)
}

function withHeaderFooter(body: string, header?: string, footer?: string): string {
  return [header?.trim(), body?.trim(), footer?.trim()].filter(Boolean).join('\n\n')
}

async function engineSendTextSms(args: SendTextEngineArgs): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({ where: { id: args.contactId, account_id: args.accountId }, select: { phone: true } })
  if (!contact?.phone) throw new Error('SMS contact has no phone number')
  const { messageId } = await sendSmsText({ accountId: args.accountId, to: contact.phone, text: args.text })
  const finalId = messageId || `sms_bot_${Date.now()}`
  await persistBotTextMessage(args.accountId, args.conversationId, args.text, finalId)
  return { whatsapp_message_id: finalId }
}

async function engineSendTextRcs(args: SendTextEngineArgs): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({ where: { id: args.contactId, account_id: args.accountId }, select: { phone: true } })
  if (!contact?.phone) throw new Error('RCS contact has no phone number')
  const { messageId } = await sendRcsText({ accountId: args.accountId, to: contact.phone, text: args.text })
  const finalId = messageId || `rcs_bot_${Date.now()}`
  await persistBotTextMessage(args.accountId, args.conversationId, args.text, finalId)
  return { whatsapp_message_id: finalId }
}

async function engineSendTextEmail(args: SendTextEngineArgs): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({ where: { id: args.contactId, account_id: args.accountId }, select: { email: true } })
  if (!contact?.email) throw new Error('Email contact has no email address')
  // A chatbot step answers the customer's latest email, in its thread.
  const { messageId, subject } = await sendConversationEmail({
    accountId: args.accountId,
    conversationId: args.conversationId,
    to: contact.email,
    text: args.text,
    mode: 'reply',
  })
  const finalId = messageId || `email_bot_${Date.now()}`
  const savedMsg = await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: 'text', content_text: args.text, email_subject: subject, message_id: finalId, status: 'sent' },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.text, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: args.text, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: finalId }
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  // Use raw SQL to read channel — avoids requiring prisma generate after schema change
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  const channel = convRows[0]?.channel

  if (isSocial(channel)) return engineSendTextSocial(args, channel)
  if (channel === 'sms') return engineSendTextSms(args)
  if (channel === 'rcs') return engineSendTextRcs(args)
  if (channel === 'email') return engineSendTextEmail(args)
  if (channel === 'website') return websiteSend(args, { text: args.text })
  if (channel === 'telegram') return telegramSend(args, { text: args.text })

  // Safety net: if channel is NULL, check if contact phone looks like an IGSID
  // (pure numeric, no '+' prefix — won't collide with valid E.164 numbers)
  if (!channel) {
    const contactRow = await prisma.contact.findFirst({
      where: { id: args.contactId },
      select: { phone: true },
    })
    if (contactRow?.phone && /^\d+$/.test(contactRow.phone) && !contactRow.phone.startsWith('+')) {
      console.warn('[engineSendText] channel NULL but phone looks like IGSID — routing to Instagram')
      return engineSendTextSocial(args, 'instagram')
    }
  }

  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId, args.conversationId)
  const accessToken = decrypt(config.access_token)

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, text: args.text }).then((r) => r.messageId)
  )

  const savedMsg = await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: 'text', content_text: args.text, message_id: waMessageId, status: 'sent' },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.text, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: args.text, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: waMessageId }
}

export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  const mediaChannel = convRows[0]?.channel
  if (isSocial(mediaChannel)) return engineSendMediaSocial(args, mediaChannel)
  if (convRows[0]?.channel === 'telegram') {
    return telegramSend(args, {
      text: args.caption ?? '',
      contentType: args.kind === 'image' ? 'image' : args.kind === 'video' ? 'video' : args.kind === 'audio' ? 'audio' : 'document',
      media: { url: args.link, mimeType: args.kind === 'image' ? 'image/jpeg' : args.kind === 'video' ? 'video/mp4' : args.kind === 'audio' ? 'audio/mpeg' : null, filename: args.filename ?? null },
    })
  }
  if (convRows[0]?.channel === 'website') {
    // Only a public https file can be shown to a visitor; an upload kept
    // behind sign-in (/api/files/…) is sent as its caption alone rather
    // than as a link that would open a login page.
    const isPublic = args.link.startsWith('https://')
    if (!isPublic) console.warn('[webchat] media is not a public https link; sending its caption only:', args.link)
    return websiteSend(args, {
      text: args.caption ?? '',
      contentType: args.kind === 'image' ? 'image' : 'document',
      media: isPublic
        ? { url: args.link, mimeType: args.kind === 'image' ? 'image/*' : null, filename: args.filename ?? null }
        : null,
    })
  }

  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId, args.conversationId)
  const accessToken = decrypt(config.access_token)

  // Resolve local /api/files/… uploads to a Meta media_id so the chatbot
  // engine can send them even when the server isn't publicly reachable.
  type MediaRef = { id: string; link?: never } | { link: string; id?: never }
  let mediaRef: MediaRef
  if (args.link.startsWith('http')) {
    mediaRef = { link: args.link }
  } else {
    // Only this account's own uploads: the path is resolved and its
    // account-<id>/ folder checked (media-ref.ts), so neither another
    // account's folder nor ../ out of this one can be read.
    const filePath = await resolveUploadPath(args.link, args.accountId)
    const fileBuffer = await readFile(filePath)
    const filename = basename(filePath)
    const mimeType = (mimeLookup(filename) || 'application/octet-stream') as string
    const mediaId = await uploadMediaToMeta({
      phoneNumberId: config.phone_number_id,
      accessToken,
      fileBuffer,
      mimeType,
      filename,
    })
    mediaRef = { id: mediaId }
  }

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendMediaMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, kind: args.kind, ...mediaRef, caption: args.caption, filename: args.filename }).then((r) => r.messageId)
  )

  const preview = args.caption?.trim() || `[${args.kind}]`
  const savedMsg = await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: args.kind, content_text: args.caption ?? null, message_id: waMessageId, status: 'sent' },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: preview, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: waMessageId }
}

async function engineSendMediaSocial(
  args: SendMediaEngineArgs,
  channel: SocialChannel,
): Promise<{ whatsapp_message_id: string }> {
  // A local upload is checked against this account before anything is read
  // or sent (media-ref.ts uploadPathFor) — never another account's file.
  const localPath = args.link.startsWith('http') ? null : await resolveUploadPath(args.link, args.accountId)
  const target: SocialTarget = await loadSocialTarget(args.accountId, args.contactId, channel)
  // Meta attachment types: image, audio, video, file.
  const type = args.kind === 'document' ? 'file' : args.kind
  await socialSenderAction(target, 'typing_on')

  let messageId: string | null
  if (!localPath) {
    ;({ messageId } = await socialPost(target, {
      recipient: { id: target.recipientId },
      message: { attachment: { type, payload: { url: args.link, is_reusable: true } } },
      messaging_type: 'RESPONSE',
    }))
  } else {
    // Local file: sent as multipart so no public URL is needed.
    const fileBuffer = await readFile(localPath)
    const filename = basename(localPath)
    const mimeType = (mimeLookup(filename) || 'application/octet-stream') as string
    const form = new FormData()
    form.append('recipient', JSON.stringify({ id: target.recipientId }))
    form.append('message', JSON.stringify({ attachment: { type, payload: { is_reusable: true } } }))
    form.append('filedata', new Blob([fileBuffer], { type: mimeType }), filename)
    form.append('messaging_type', 'RESPONSE')
    const res = await fetch(`${target.url}?access_token=${encodeURIComponent(target.token)}`, { method: 'POST', body: form })
    const data = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } }
    if (!res.ok || data.error) {
      const { explainMetaError } = await import('@/lib/meta/social-messaging')
      console.error(`[${channel} media] Meta error:`, res.status, data.error?.code, data.error?.message)
      throw new Error(explainMetaError(data.error, res.status))
    }
    messageId = data.message_id ?? null
  }

  // A caption travels as its own text message (attachments carry none).
  if (args.caption?.trim()) {
    await socialPost(target, { recipient: { id: target.recipientId }, message: { text: convertMarkdownForInstagram(args.caption) }, messaging_type: 'RESPONSE' })
      .catch((err) => console.warn(`[${channel} media] caption not sent:`, err?.message))
  }

  const mid = messageId ?? `${channel === 'instagram' ? 'ig' : 'fb'}_media_${Date.now()}`
  await persistSocialBotMessage(args, { contentType: args.kind, text: args.caption ?? `[${args.kind}]`, mediaUrl: args.link, messageId: mid })
  return { whatsapp_message_id: mid }
}

export async function engineSendTemplate(
  args: SendTemplateEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  notOnChannel(await channelOf(args.conversationId), 'WhatsApp templates')
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId, args.conversationId)
  const accessToken = decrypt(config.access_token)

  const params = args.bodyParams
    ? args.bodyParams.split(',').map((p) => p.trim()).filter(Boolean)
    : []

  // Look up the full template row so buildSendComponents can include
  // FLOW buttons, media headers, and URL buttons — not just body params.
  const templateRow = await prisma.messageTemplate.findFirst({
    where: {
      account_id: args.accountId,
      name: args.templateName,
      ...(args.languageCode ? { language: args.languageCode } : {}),
    },
  })

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      templateName: args.templateName,
      language: args.languageCode,
      // A header file from /api/files/... must be this account's own.
      accountId: args.accountId,
      ...(templateRow
        ? {
            template: {
              ...templateRow,
              language: templateRow.language ?? undefined,
              category: templateRow.category as 'Marketing' | 'Utility' | 'Authentication',
              header_type: templateRow.header_type as 'text' | 'image' | 'video' | 'document' | undefined,
              header_content: templateRow.header_content ?? undefined,
              header_handle: templateRow.header_handle ?? undefined,
              header_media_url: templateRow.header_media_url ?? undefined,
              footer_text: templateRow.footer_text ?? undefined,
              rejection_reason: templateRow.rejection_reason ?? undefined,
              quality_score: templateRow.quality_score as 'GREEN' | 'YELLOW' | 'RED' | undefined,
              submission_error: templateRow.submission_error ?? undefined,
              meta_template_id: templateRow.meta_template_id ?? undefined,
              last_submitted_at: templateRow.last_submitted_at?.toISOString() ?? undefined,
              status: templateRow.status as import('@/types').MessageTemplateStatus | undefined,
              buttons: templateRow.buttons as import('@/types').TemplateButton[] | undefined,
              sample_values: templateRow.sample_values as import('@/types').TemplateSampleValues | undefined,
              created_at: templateRow.created_at.toISOString(),
            },
            messageParams: {
              body: params.length > 0 ? params : undefined,
              bodyByName: args.bodyByName,
              headerText: args.headerText,
              headerMediaUrl: args.headerMediaUrl,
              buttonParams: args.buttonParams,
            },
          }
        : { params }),
    }).then((r) => r.messageId)
  )

  // Render the actual body text and note any header media used, so the
  // saved Message row (and the inbox bubble) shows real content instead
  // of just a bare "Template" pill — previously this only ever stored
  // template_name, leaving content_text/media_url null even though both
  // were already fully resolved above for the Meta send itself.
  const renderedBody = !templateRow
    ? `[Template: ${args.templateName}]`
    : args.bodyByName
      ? Object.entries(args.bodyByName).reduce((text, [key, val]) => text.replaceAll(`{{${key}}}`, val?.trim() ? val : ' '), templateRow.body_text)
      : params.reduce((text, val, i) => text.replaceAll(`{{${i + 1}}}`, val?.trim() ? val : ' '), templateRow.body_text)
  const headerMediaUrl = args.headerMediaUrl ?? templateRow?.header_media_url ?? null
  const headerType = templateRow?.header_type
  const headerMimeType = headerType === 'image' ? 'image/jpeg' : headerType === 'video' ? 'video/mp4' : null

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'template',
      content_text: renderedBody,
      template_name: args.templateName,
      media_url: headerType && headerType !== 'text' ? headerMediaUrl : null,
      media_mime_type: headerMimeType,
      message_id: waMessageId,
      status: 'sent',
    },
  })
  const templatePreview = renderedBody || `[Template: ${args.templateName}]`
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: templatePreview, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: templatePreview, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: waMessageId }
}

interface SendCatalogEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  mode: 'catalog' | 'single_product' | 'multi_product'
  bodyText: string
  headerText?: string
  footerText?: string
  productRetailerId?: string
  productRetailerIds?: string[]
}

/**
 * Mirrors engineSendTemplate's shape, but the catalog itself comes from
 * CatalogConfig (one per account, same as WhatsAppConfig) rather than
 * being passed in — a flow author picks WHAT to send, not which catalog,
 * same as they never pick which WABA to send from.
 */
export async function engineSendCatalog(
  args: SendCatalogEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  notOnChannel(await channelOf(args.conversationId), 'WhatsApp catalog messages')
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId, args.conversationId)
  const accessToken = decrypt(config.access_token)

  const catalogConfig = await prisma.catalogConfig.findUnique({ where: { account_id: args.accountId } })
  if (!catalogConfig) throw new Error('No catalog connected for this account')

  let contentText = args.bodyText
  let preview = args.bodyText

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) => {
    if (args.mode === 'single_product') {
      if (!args.productRetailerId) throw new Error('send_catalog (single_product) requires a product selection')
      return sendSingleProductMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        catalogId: catalogConfig.catalog_id,
        productRetailerId: args.productRetailerId,
        bodyText: args.bodyText || undefined,
        footerText: args.footerText,
      }).then((r) => r.messageId)
    }
    if (args.mode === 'multi_product') {
      const ids = args.productRetailerIds ?? []
      if (ids.length === 0) throw new Error('send_catalog (multi_product) requires at least one product')
      preview = args.headerText || args.bodyText
      contentText = args.bodyText
      return sendMultiProductMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        catalogId: catalogConfig.catalog_id,
        headerText: args.headerText || 'Take a look at these',
        bodyText: args.bodyText,
        footerText: args.footerText,
        sections: [{ productRetailerIds: ids }],
      }).then((r) => r.messageId)
    }
    return sendCatalogMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      bodyText: args.bodyText,
      footerText: args.footerText,
    }).then((r) => r.messageId)
  })

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: args.mode,
      content_text: contentText || preview,
      message_id: waMessageId,
      status: 'sent',
    },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: preview, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: waMessageId }
}

interface SendFlowEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  flowId: string
  flowCta: string
  bodyText?: string
  headerText?: string
  footerText?: string
  flowToken?: string
  /**
   * Meta's own "Request data on first screen", set on the Send Flow node.
   *
   * Left undefined we guess, by looking for table-backed fields in the
   * stored screens. The guess is a convenience for Flows built here; a
   * Flow authored in Meta's Flow Builder carries no marker we can read,
   * so the setting is what actually decides it.
   */
  requestData?: boolean
}

/**
 * Does this Flow have fields that come out of a table?
 *
 * Such a Flow has to ask our endpoint for them, and WhatsApp only asks
 * when the message opens with `data_exchange`. Sent with `navigate` — as
 * every Flow used to be — the dropdown renders with nothing in it, which
 * is exactly what customers saw while Meta's own Flow Builder preview
 * looked perfect, because that preview supplies its own mock data.
 *
 * The check is a substring scan of the stored screens. `_source_table_id`
 * is a private key this app writes into the Flow JSON and nothing else
 * uses it, so a plain search is both sufficient and cheaper than walking
 * a tree of unknown depth.
 */
async function flowNeedsEndpoint(accountId: string, metaFlowId: string): Promise<boolean> {
  const row = await prisma.flow
    .findFirst({
      where: {
        account_id: accountId,
        flow_type: 'whatsapp_flow',
        trigger_config: { path: ['meta_flow_id'], equals: metaFlowId },
      },
      select: { trigger_config: true },
    })
    .catch(() => null)
  if (!row) return false
  const cfg = row.trigger_config as Record<string, unknown> | null
  if (!cfg?.screens) return false
  return JSON.stringify(cfg.screens).includes('_source_table_id')
}

export async function engineSendFlow(
  args: SendFlowEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  notOnChannel(await channelOf(args.conversationId), 'WhatsApp Flows forms')
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId, args.conversationId)
  const accessToken = decrypt(config.access_token)
  // An explicit answer beats a guess. A Flow authored in Meta's own Flow
  // Builder carries none of the markers flowNeedsEndpoint looks for, so
  // inference alone would keep sending it the wrong way forever — which
  // is exactly what happened: the same Flow worked when sent by hand from
  // Meta with "Request data" ticked, and arrived empty from here.
  const needsEndpoint =
    typeof args.requestData === 'boolean'
      ? args.requestData
      : await flowNeedsEndpoint(args.accountId, args.flowId)
  const flowAction = needsEndpoint ? ('data_exchange' as const) : ('navigate' as const)
  console.log(
    '[engineSendFlow] flow:', args.flowId,
    '| action:', flowAction,
    '| from:', typeof args.requestData === 'boolean' ? 'node setting' : 'auto-detect',
  )

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendFlowMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      flowId: args.flowId,
      flowCta: args.flowCta,
      bodyText: args.bodyText,
      headerText: args.headerText,
      footerText: args.footerText,
      flowToken: args.flowToken,
      flowAction,
    }).then((r) => r.messageId)
  )

  const preview = args.bodyText ?? `[Flow: ${args.flowCta}]`
  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'interactive',
      content_text: preview,
      message_id: waMessageId,
      status: 'sent',
    },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: preview, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: waMessageId }
}

interface SendToNumberEngineArgs {
  accountId: string
  phone: string  // E.164 or local; will be sanitized
  text: string
}

/**
 * Send a WhatsApp text message to an arbitrary phone number using the
 * account's WhatsApp config. Does NOT create a Conversation or Message
 * record — this is a side-effect notification, not an inbox event.
 * Caller must handle errors; this throws on failure.
 */
export async function engineSendToNumber(
  args: SendToNumberEngineArgs,
): Promise<void> {
  // Admin notification, no conversation context — always the account's
  // default number (Finding #14).
  let config
  try {
    config = await resolveWhatsAppConfig({ accountId: args.accountId })
  } catch (err) {
    if (err instanceof NoWhatsAppConfigError) throw new Error('WhatsApp not configured for this account')
    throw err
  }

  const accessToken = decrypt(config.access_token)
  const sanitized = sanitizePhoneForMeta(args.phone)
  if (!isValidE164(sanitized)) throw new Error(`Invalid phone number: ${args.phone}`)

  await sendTextMessage({
    phoneNumberId: config.phone_number_id,
    accessToken,
    to: sanitized,
    text: args.text,
  })
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  const btnChannel = convRows[0]?.channel
  if (isSocial(btnChannel)) {
    return engineSendButtonTemplateSocial(
      args, btnChannel, withHeaderFooter(args.bodyText, args.headerText, args.footerText),
      args.buttons.map((b) => ({ type: 'postback' as const, title: b.title, payload: b.id })),
    )
  }
  if (convRows[0]?.channel === 'telegram') {
    return telegramSend(args, {
      text: withHeaderFooter(args.bodyText, args.headerText, args.footerText),
      buttons: args.buttons.map((b) => ({ id: b.id, title: b.title })),
      media: args.headerMediaUrl && args.headerMediaType === 'image' ? { url: args.headerMediaUrl, mimeType: 'image/jpeg' } : null,
    })
  }
  if (convRows[0]?.channel === 'website') {
    return websiteSend(args, {
      text: withHeaderFooter(args.bodyText, args.headerText, args.footerText),
      buttons: args.buttons.map((b) => ({ id: b.id, title: b.title })),
      media:
        args.headerMediaUrl?.startsWith('https://') && args.headerMediaType === 'image'
          ? { url: args.headerMediaUrl, mimeType: 'image/*' }
          : null,
    })
  }
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  // Instagram doesn't support list messages — fall back to plain text with options listed
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  if (isSocial(convRows[0]?.channel)) {
    const items = args.sections.flatMap((s) => s.rows).map((r, i) => `${i + 1}. ${r.title}`).join('\n')
    const fallbackText = `${args.bodyText ?? ''}\n\n${items}`.trim()
    return engineSendText({ ...args, text: fallbackText })
  }
  if (convRows[0]?.channel === 'website') {
    return websiteSend(args, {
      text: withHeaderFooter(args.bodyText, args.headerText, args.footerText),
      buttons: args.sections.flatMap((section) => section.rows).map((r) => ({ id: r.id, title: r.title })),
    })
  }
  if (convRows[0]?.channel === 'telegram') {
    return telegramSend(args, {
      text: withHeaderFooter(args.bodyText, args.headerText, args.footerText),
      buttons: args.sections.flatMap((section) => section.rows).map((r) => ({ id: r.id, title: r.title })),
    })
  }
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const { contact, sanitized, config } = await resolveContactAndConfig(input.accountId, input.contactId, input.conversationId)
  const accessToken = decrypt(config.access_token)

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, async (phone) => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({ phoneNumberId: config.phone_number_id, accessToken, to: phone, bodyText: input.bodyText, buttons: input.buttons, headerText: input.headerText, headerMediaUrl: input.headerMediaUrl, headerMediaType: input.headerMediaType, footerText: input.footerText })
      return r.messageId
    }
    const r = await sendInteractiveList({ phoneNumberId: config.phone_number_id, accessToken, to: phone, bodyText: input.bodyText, buttonLabel: input.buttonLabel, sections: input.sections, headerText: input.headerText, footerText: input.footerText })
    return r.messageId
  })

  const savedMsg = await prisma.message.create({
    data: { conversation_id: input.conversationId, sender_type: 'bot', content_type: 'interactive', content_text: input.bodyText, message_id: waMessageId, status: 'sent' },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { last_message_text: input.bodyText, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(input.accountId, savedMsg, input.conversationId, { last_message_text: input.bodyText, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: waMessageId }
}

export async function engineSendCtaUrlButton(
  args: SendCtaUrlButtonEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  // Instagram has no CTA-URL-button equivalent — fall back to plain text
  // with the link appended, same strategy used for the list-message IG fallback.
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  const ctaChannel = convRows[0]?.channel
  if (isSocial(ctaChannel)) {
    if (/^https:\/\//i.test(args.url)) {
      return engineSendButtonTemplateSocial(
        args, ctaChannel, withHeaderFooter(args.bodyText, args.headerText, args.footerText),
        [{ type: 'web_url', title: args.displayText || 'Open', url: args.url }],
      )
    }
    const fallbackText = `${args.bodyText ?? ''}\n\n${args.displayText}: ${args.url}`.trim()
    return engineSendText({ ...args, text: fallbackText })
  }
  if (convRows[0]?.channel === 'website') {
    return websiteSend(args, {
      text: withHeaderFooter(args.bodyText, args.headerText, args.footerText),
      link: { label: args.displayText, url: args.url },
    })
  }
  if (convRows[0]?.channel === 'telegram') {
    return telegramSend(args, {
      text: withHeaderFooter(args.bodyText, args.headerText, args.footerText),
      link: { label: args.displayText, url: args.url },
    })
  }

  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId, args.conversationId)
  const accessToken = decrypt(config.access_token)

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, async (phone) => {
    const r = await sendCtaUrlButton({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      bodyText: args.bodyText,
      headerText: args.headerText,
      footerText: args.footerText,
      displayText: args.displayText,
      url: args.url,
    })
    return r.messageId
  })

  const savedMsg = await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: 'interactive', content_text: args.bodyText, message_id: waMessageId, status: 'sent' },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.bodyText, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, { last_message_text: args.bodyText, last_message_at: lastMessageAt.toISOString() })
  return { whatsapp_message_id: waMessageId }
}

/**
 * Sends generated speech as a WhatsApp audio message.
 *
 * Separate from engineSendMedia because that helper's input is a link or
 * an on-disk upload path, and synthesized speech is neither — it exists
 * only as bytes in memory. Writing it to the uploads directory first
 * just to read it back would leave a file per voice reply with nothing
 * to clean them up.
 *
 * The transcript is stored as the message's text so the conversation
 * list, search and the agent reading the thread all see what the bot
 * actually said, rather than "[audio]".
 */
export async function engineSendVoiceNote(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  audio: Buffer
  mimeType: string
  /** The text that was spoken — stored, not sent. */
  transcript: string
}): Promise<{ whatsapp_message_id: string }> {
  // A website window plays no voice notes; the visitor reads the words.
  // Telegram gets the words too — the audio is made for WhatsApp's format.
  const voiceChannel = await channelOf(args.conversationId)
  if (voiceChannel === 'website') return websiteSend(args, { text: args.transcript })
  if (voiceChannel === 'telegram') return telegramSend(args, { text: args.transcript })
  const { contact, sanitized, config } = await resolveContactAndConfig(
    args.accountId,
    args.contactId,
    args.conversationId,
  )
  const accessToken = decrypt(config.access_token)

  const mediaId = await uploadMediaToMeta({
    phoneNumberId: config.phone_number_id,
    accessToken,
    fileBuffer: args.audio,
    mimeType: args.mimeType,
    filename: args.mimeType.includes('mpeg') ? 'reply.mp3' : 'reply.ogg',
  })

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendMediaMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      kind: 'audio',
      id: mediaId,
    }).then((r) => r.messageId),
  )

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'audio',
      content_text: args.transcript,
      transcript: args.transcript,
      message_id: waMessageId,
      status: 'sent',
    },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.transcript.slice(0, 120), last_message_at: lastMessageAt },
  })
  await notifyBotMessage(args.accountId, savedMsg, args.conversationId, {
    last_message_text: args.transcript.slice(0, 120),
    last_message_at: lastMessageAt.toISOString(),
  })
  return { whatsapp_message_id: waMessageId }
}
