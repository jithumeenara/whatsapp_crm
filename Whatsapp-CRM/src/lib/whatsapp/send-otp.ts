/**
 * Customer-facing OTP/Utility Quick Send (Finding #08a) — delivers the
 * real "send an OTP easily" want without depending on Meta's gated
 * Direct Send beta (see sendDirectMessage in meta-api.ts, only usable
 * once Meta grants per-WABA approval this app can't self-serve).
 *
 * Reuses the exact mechanism this app's own login MFA already proves
 * works (src/lib/auth/mfa.ts's sendWhatsappOtp): a pre-approved
 * Authentication-category template with a COPY_CODE button, filled with
 * the live code at send time. If direct_send_enabled is on for the
 * resolved number, tries the beta path first (no template needed at
 * all) and falls back to the template path on failure — so a tenant
 * who does get Meta's approval benefits immediately, and everyone else
 * keeps using the fully-working template path.
 */
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'
import { sendTemplateMessage, sendDirectMessage } from '@/lib/whatsapp/meta-api'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { emitToAccount } from '@/lib/socket'

export class NoOtpTemplateError extends Error {
  constructor() {
    super('No approved WhatsApp Authentication-category template found — create and get one approved in Settings > Templates first.')
    this.name = 'NoOtpTemplateError'
  }
}

export async function sendOtpToContact(args: {
  accountId: string
  userId: string
  contactId: string
  conversationId: string
  code: string
}): Promise<{ whatsapp_message_id: string }> {
  const { accountId, userId, contactId, conversationId, code } = args

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, account_id: accountId },
    select: { phone: true },
  })
  if (!contact?.phone) throw new Error('Contact has no phone number.')
  const contactPhone = contact.phone

  const config = await resolveWhatsAppConfig({ accountId, conversationId })
  const accessToken = decrypt(config.access_token)

  let waMessageId: string
  let renderedBody: string
  let templateName: string | null = null

  // Direct Send beta first, when this tenant has flagged it as
  // approved (Finding #08b) — no template needed at all.
  if (config.direct_send_enabled) {
    try {
      const text = `Your verification code is ${code}. Do not share it with anyone.`
      const result = await sendDirectMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: contactPhone,
        text,
        category: 'authentication',
      })
      waMessageId = result.messageId
      renderedBody = text
    } catch (err) {
      console.warn('[send-otp] Direct Send failed, falling back to template path:', err instanceof Error ? err.message : err)
      const fallback = await sendViaTemplate()
      waMessageId = fallback.waMessageId
      renderedBody = fallback.renderedBody
      templateName = fallback.templateName
    }
  } else {
    const result = await sendViaTemplate()
    waMessageId = result.waMessageId
    renderedBody = result.renderedBody
    templateName = result.templateName
  }

  async function sendViaTemplate() {
    const template = await prisma.messageTemplate.findFirst({
      where: {
        account_id: accountId,
        category: 'Authentication',
        status: 'APPROVED',
        ...(config.waba_id ? { waba_id: config.waba_id } : {}),
      },
      orderBy: { created_at: 'asc' },
    })
    if (!template || !isMessageTemplate(template)) throw new NoOtpTemplateError()

    const result = await sendTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: contactPhone,
      templateName: template.name,
      language: template.language ?? 'en_US',
      template,
      messageParams: { body: [code], buttonParams: { 0: code } },
    })
    const rendered = template.body_text.replaceAll('{{1}}', code)
    return { waMessageId: result.messageId, renderedBody: rendered, templateName: template.name }
  }

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: userId,
      content_type: templateName ? 'template' : 'text',
      content_text: renderedBody,
      template_name: templateName,
      message_id: waMessageId,
      status: 'sent',
    },
  })
  const lastMessageAt = new Date()
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { last_message_text: renderedBody, last_message_at: lastMessageAt },
  })
  emitToAccount(accountId, 'message', { eventType: 'INSERT', new: savedMsg, old: {} })
  emitToAccount(accountId, 'conversation', {
    eventType: 'UPDATE',
    new: { id: conversationId, last_message_text: renderedBody, last_message_at: lastMessageAt.toISOString() },
    old: {},
  })

  return { whatsapp_message_id: waMessageId }
}
