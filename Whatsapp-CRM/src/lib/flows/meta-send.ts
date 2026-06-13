import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { prisma } from '@/lib/db'

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
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
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

async function resolveContactAndConfig(accountId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, account_id: accountId },
    select: { id: true, phone: true },
  })
  if (!contact?.phone) throw new Error('contact not found for this account')

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) throw new Error(`contact phone invalid: ${contact.phone}`)

  const config = await prisma.whatsAppConfig.findUnique({ where: { account_id: accountId } })
  if (!config) throw new Error('WhatsApp not configured for this account')

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

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId)
  const accessToken = decrypt(config.access_token)

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, text: args.text }).then((r) => r.messageId)
  )

  await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: 'text', content_text: args.text, message_id: waMessageId, status: 'sent' },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.text, last_message_at: new Date() },
  })
  return { whatsapp_message_id: waMessageId }
}

export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId)
  const accessToken = decrypt(config.access_token)

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendMediaMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, kind: args.kind, link: args.link, caption: args.caption, filename: args.filename }).then((r) => r.messageId)
  )

  const preview = args.caption?.trim() || `[${args.kind}]`
  await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: args.kind, content_text: args.caption ?? null, message_id: waMessageId, status: 'sent' },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: new Date() },
  })
  return { whatsapp_message_id: waMessageId }
}

export async function engineSendTemplate(
  args: SendTemplateEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId)
  const accessToken = decrypt(config.access_token)

  const params = args.bodyParams
    ? args.bodyParams.split(',').map((p) => p.trim()).filter(Boolean)
    : []

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, (phone) =>
    sendTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      templateName: args.templateName,
      language: args.languageCode,
      params,
    }).then((r) => r.messageId)
  )

  await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'template',
      template_name: args.templateName,
      message_id: waMessageId,
      status: 'sent',
    },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: `[Template: ${args.templateName}]`, last_message_at: new Date() },
  })
  return { whatsapp_message_id: waMessageId }
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const { contact, sanitized, config } = await resolveContactAndConfig(input.accountId, input.contactId)
  const accessToken = decrypt(config.access_token)

  const { waMessageId } = await retryWithVariants(sanitized, contact.id, async (phone) => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({ phoneNumberId: config.phone_number_id, accessToken, to: phone, bodyText: input.bodyText, buttons: input.buttons, headerText: input.headerText, footerText: input.footerText })
      return r.messageId
    }
    const r = await sendInteractiveList({ phoneNumberId: config.phone_number_id, accessToken, to: phone, bodyText: input.bodyText, buttonLabel: input.buttonLabel, sections: input.sections, headerText: input.headerText, footerText: input.footerText })
    return r.messageId
  })

  await prisma.message.create({
    data: { conversation_id: input.conversationId, sender_type: 'bot', content_type: 'interactive', content_text: input.bodyText, message_id: waMessageId, status: 'sent' },
  })
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { last_message_text: input.bodyText, last_message_at: new Date() },
  })
  return { whatsapp_message_id: waMessageId }
}
