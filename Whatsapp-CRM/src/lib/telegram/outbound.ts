/**
 * Sending to a customer on Telegram — one path for the Inbox (agents),
 * chatbot steps, automations and the assistant.
 *
 * Sent first, recorded after: a message Telegram refused is not shown as
 * sent. Text keeps WhatsApp's formatting (*bold*, _italic_…) as Telegram
 * HTML, falling back to plain text if Telegram cannot read it; chatbot buttons and list rows become
 * Telegram's inline buttons; files from the CRM's own storage are uploaded,
 * public https links are passed to Telegram to fetch.
 */

import { readFile } from 'fs/promises'
import { MediaPathError, uploadPathFor } from '@/lib/whatsapp/media-ref'
import { basename } from 'path'
import { lookup as mimeLookup } from 'mime-types'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { tgCall, TelegramApiError, type SentMessage } from './api'
import { botForAccount, TELEGRAM_CHANNEL } from './store'
import { inlineKeyboard, type ButtonSpec } from './links'
import { toTelegramHtml } from './format'

/** Telegram's limit for a file a bot uploads. */
const MAX_UPLOAD = 50 * 1024 * 1024
const TEXT_LIMIT = 4096
const CAPTION_LIMIT = 1024

export class TelegramSendError extends Error {}

export interface TelegramSendArgs {
  accountId: string
  conversationId: string
  senderType: 'bot' | 'agent'
  senderId?: string | null
  text: string
  buttons?: ButtonSpec[]
  media?: { url: string; mimeType?: string | null; filename?: string | null } | null
  /** What the Inbox shows for this message when it is not text. */
  contentType?: string
  botSource?: string | null
  /** Ask for the customer's own number with Telegram's "Share" button. */
  askForNumber?: boolean
  /** A button that opens a web page (a chatbot's "link" step). */
  link?: { label: string; url: string } | null
}

/** Splits long text at line breaks, never mid-word when it can help it. */
export function splitText(text: string, limit = TEXT_LIMIT): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit)
    if (cut < limit / 2) cut = limit
    out.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest || out.length === 0) out.push(rest)
  return out
}

/** Text in Telegram's HTML mode (WhatsApp's *bold* etc. converted); if
 *  Telegram cannot read the markup, the same words go as plain text. */
async function sendFormatted(token: string, method: string, body: Record<string, unknown>, textField: 'text' | 'caption', text: string): Promise<SentMessage> {
  try {
    return await tgCall<SentMessage>(token, method, { ...body, [textField]: toTelegramHtml(text), parse_mode: 'HTML' })
  } catch (err) {
    if (err instanceof TelegramApiError && err.status === 400 && /parse entities|unsupported start tag|can't find end/i.test(err.message)) {
      return tgCall<SentMessage>(token, method, { ...body, [textField]: text })
    }
    throw err
  }
}

function methodFor(mime: string | null | undefined, url: string): { method: string; field: string; kind: string } {
  const m = (mime || (mimeLookup(url) || '') || '').toLowerCase()
  if (m.startsWith('image/') && !m.includes('gif') && !m.includes('svg')) return { method: 'sendPhoto', field: 'photo', kind: 'image' }
  if (m.startsWith('video/')) return { method: 'sendVideo', field: 'video', kind: 'video' }
  if (m.startsWith('audio/')) return { method: 'sendAudio', field: 'audio', kind: 'audio' }
  return { method: 'sendDocument', field: 'document', kind: 'document' }
}

/** A file from the CRM's own storage, read here — Telegram cannot open a login-only link. */
async function localFile(accountId: string, url: string): Promise<{ bytes: Buffer; name: string; mime: string } | null> {
  if (!url.startsWith('/api/files/')) return null
  // A per-account file must be this account's — checked on the resolved
  // path, so ../ and ./ cannot reach another account's folder.
  let path: string
  try {
    path = uploadPathFor(url, accountId)
  } catch (err) {
    throw new TelegramSendError(err instanceof MediaPathError ? err.message : 'Invalid file path')
  }
  const bytes = await readFile(path)
  if (bytes.length > MAX_UPLOAD) throw new TelegramSendError('The file is larger than 50 MB — Telegram does not accept it from a bot.')
  const name = basename(path)
  return { bytes, name, mime: (mimeLookup(name) || 'application/octet-stream') as string }
}

export async function sendToTelegram(args: TelegramSendArgs) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: args.conversationId, account_id: args.accountId, channel: TELEGRAM_CHANNEL },
    select: { id: true, telegram_business_connection_id: true, contact: { select: { telegram_id: true } } },
  })
  if (!conversation) throw new TelegramSendError('Telegram conversation not found')
  const chatId = conversation.contact?.telegram_id
  if (!chatId) throw new TelegramSendError('This contact has no Telegram chat.')
  const bot = await botForAccount(args.accountId)
  if (!bot) throw new TelegramSendError('Telegram is not connected. Connect the bot in Settings → Channels → Telegram.')

  const via = conversation.telegram_business_connection_id ? { business_connection_id: conversation.telegram_business_connection_id } : {}
  const { keyboard, meta } = inlineKeyboard(args.buttons ?? [])
  const linkRow = args.link && /^https:\/\//i.test(args.link.url) ? [[{ text: args.link.label.slice(0, 64) || 'Open', url: args.link.url }]] : []
  const replyMarkup = args.askForNumber
    ? { keyboard: [[{ text: '📱 Share my number', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
    : keyboard.length || linkRow.length ? { inline_keyboard: [...keyboard, ...linkRow] } : undefined
  const text = args.text ?? ''
  let sent: SentMessage

  if (args.media?.url) {
    const { method, field, kind } = methodFor(args.media.mimeType, args.media.url)
    const caption = text.length <= CAPTION_LIMIT ? text : ''
    const file = await localFile(args.accountId, args.media.url)
    if (file) {
      const form = new FormData()
      form.append('chat_id', chatId)
      form.append(field, new Blob([new Uint8Array(file.bytes)], { type: file.mime }), args.media.filename || file.name)
      if (caption) {
        form.append('caption', toTelegramHtml(caption))
        form.append('parse_mode', 'HTML')
      }
      if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup))
      if (via.business_connection_id) form.append('business_connection_id', via.business_connection_id)
      sent = await tgCall<SentMessage>(bot.token, method, form)
    } else if (/^https:\/\//i.test(args.media.url)) {
      const body = { chat_id: chatId, [field]: args.media.url, ...(replyMarkup ? { reply_markup: replyMarkup } : {}), ...via }
      sent = caption ? await sendFormatted(bot.token, method, body, 'caption', caption) : await tgCall<SentMessage>(bot.token, method, body)
    } else {
      throw new TelegramSendError('Only files from the file manager or a public https link can be sent on Telegram.')
    }
    // A caption too long for Telegram follows as its own message.
    if (!caption && text) {
      for (const part of splitText(text)) await sendFormatted(bot.token, 'sendMessage', { chat_id: chatId, ...via }, 'text', part)
    }
    return record(args, sent, chatId, { contentType: args.contentType ?? kind, meta })
  }

  if (!text.trim()) throw new TelegramSendError('Nothing to send.')
  const parts = splitText(text)
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1
    sent = await sendFormatted(bot.token, 'sendMessage', {
      chat_id: chatId,
      ...(last && replyMarkup ? { reply_markup: replyMarkup } : {}),
      ...via,
    }, 'text', parts[i])
  }
  return record(args, sent!, chatId, { contentType: args.contentType ?? (meta.length ? 'interactive' : 'text'), meta })
}

async function record(args: TelegramSendArgs, sent: SentMessage, chatId: string, opts: { contentType: string; meta: Array<{ id: string; title: string; cb: string }> }) {
  const telegramMeta = opts.meta.length ? { buttons: opts.meta } : undefined
  const row = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: args.senderType,
      sender_id: args.senderId ?? null,
      content_type: opts.contentType,
      content_text: args.text,
      media_url: args.media?.url ?? null,
      media_mime_type: args.media?.mimeType ?? null,
      media_filename: args.media?.filename ?? null,
      message_id: `tg:${chatId}:${sent.message_id}`,
      status: 'sent',
      bot_source: args.botSource ?? null,
      ...(telegramMeta ? { telegram_meta: telegramMeta as unknown as Prisma.InputJsonValue } : {}),
    },
  })
  const lastMessageAt = new Date()
  const updated = await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.text || (args.media ? '[Attachment]' : ''), last_message_at: lastMessageAt },
  })
  emitToAccount(args.accountId, 'message', { eventType: 'INSERT', new: row, old: {} })
  emitToAccount(args.accountId, 'conversation', { eventType: 'UPDATE', new: updated, old: {} })
  return row
}

export { TelegramApiError }
