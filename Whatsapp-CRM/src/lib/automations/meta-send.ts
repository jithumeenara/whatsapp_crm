import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { prisma } from '@/lib/db'
import { sendSmsText } from '@/lib/messaging/channels/sms'
import { sendEmail } from '@/lib/messaging/channels/email'
import { sendRcsText } from '@/lib/messaging/channels/rcs'

interface SendTextArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

/** Same missing-real-time-emit bug fixed in flows/meta-send.ts — neither
 * message-create site in this file was calling `emitToAccount`, so an
 * automation's bot reply never appeared in the Inbox live; an agent had to
 * manually refresh to see it. */
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

/** Shared persistence for the SMS/Email/RCS channels — mirrors sendViaMeta's
 *  message-row + conversation-touch pattern for the WhatsApp path below. */
async function persistBotTextMessage(accountId: string, conversationId: string, text: string, messageId: string, emailSubject?: string) {
  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: conversationId, sender_type: 'bot', content_type: 'text',
      content_text: text, message_id: messageId, status: 'sent',
      email_subject: emailSubject ?? null,
    },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { last_message_text: text, last_message_at: lastMessageAt },
  })
  await notifyBotMessage(accountId, savedMsg, conversationId, { last_message_text: text, last_message_at: lastMessageAt.toISOString() })
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  // Template sends stay WhatsApp-only (no SMS/Email/RCS template equivalent
  // in this phase) — only plain text branches by channel.
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  const channel = convRows[0]?.channel

  if (channel === 'sms' || channel === 'rcs') {
    const contact = await prisma.contact.findFirst({ where: { id: args.contactId, account_id: args.accountId }, select: { phone: true } })
    if (!contact?.phone) throw new Error(`${channel} contact has no phone number`)
    const { messageId } = channel === 'sms'
      ? await sendSmsText({ accountId: args.accountId, to: contact.phone, text: args.text })
      : await sendRcsText({ accountId: args.accountId, to: contact.phone, text: args.text })
    const finalId = messageId || `${channel}_bot_${Date.now()}`
    await persistBotTextMessage(args.accountId, args.conversationId, args.text, finalId)
    return { whatsapp_message_id: finalId }
  }
  if (channel === 'email') {
    const contact = await prisma.contact.findFirst({ where: { id: args.contactId, account_id: args.accountId }, select: { email: true } })
    if (!contact?.email) throw new Error('Email contact has no email address')
    const subject = args.text.slice(0, 60).trim() || 'New message'
    const { messageId } = await sendEmail({ accountId: args.accountId, to: contact.email, subject, text: args.text })
    const finalId = messageId || `email_bot_${Date.now()}`
    await persistBotTextMessage(args.accountId, args.conversationId, args.text, finalId, subject)
    return { whatsapp_message_id: finalId }
  }

  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, account_id: input.accountId },
    select: { id: true, phone: true },
  })
  if (!contact?.phone) throw new Error('contact not found for this account')

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) throw new Error(`contact phone invalid: ${contact.phone}`)

  const config = await prisma.whatsAppConfig.findUnique({
    where: { account_id: input.accountId },
  })
  if (!config) throw new Error('WhatsApp not configured for this account')

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        params: input.params,
      })
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

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
    await prisma.contact.update({ where: { id: contact.id }, data: { phone: workingPhone } })
  }

  const content_type = input.kind === 'template' ? 'template' : 'text'
  const template_name = input.kind === 'template' ? input.templateName : null

  // Same bug fixed in flows/meta-send.ts's engineSendTemplate — content_text
  // was always left null for a template send, so the message showed as a
  // bare "Template" pill in the inbox with no visible text at all.
  let content_text: string | null = input.kind === 'text' ? input.text : null
  if (input.kind === 'template') {
    const templateRow = await prisma.messageTemplate.findFirst({
      where: { account_id: input.accountId, name: input.templateName, ...(input.language ? { language: input.language } : {}) },
      select: { body_text: true },
    })
    if (templateRow) {
      const params = input.params ?? []
      content_text = params.reduce((text, val, i) => text.replaceAll(`{{${i + 1}}}`, val?.trim() ? val : ' '), templateRow.body_text)
    } else {
      content_text = `[Template: ${input.templateName}]`
    }
  }

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type,
      content_text,
      template_name,
      message_id: waMessageId,
      status: 'sent',
    },
  })

  const lastMessageText =
    input.kind === 'template' ? (content_text || `[template:${input.templateName}]`) : input.text
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      last_message_text: lastMessageText,
      last_message_at: lastMessageAt,
    },
  })
  await notifyBotMessage(input.accountId, savedMsg, input.conversationId, {
    last_message_text: lastMessageText,
    last_message_at: lastMessageAt.toISOString(),
  })

  return { whatsapp_message_id: waMessageId }
}
