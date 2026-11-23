import { NextResponse } from 'next/server'
import { catalogForWaba } from '@/lib/catalog/for-number'
import { envelopeFor, humanAgentEnabled, lastInboundAt, loadSocialTarget, socialPost, socialSendAttachment, windowDecision, type SocialChannel, type SocialTarget } from '@/lib/meta/social-messaging'
import { checkParams, renderTemplate, sendUtilityTemplate } from '@/lib/meta/messenger-templates'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { verifyApiKey } from '@/lib/auth/api-key'
import { canSendMessages, isAccountRole } from '@/lib/auth/roles'
import { sendTextMessage, sendTemplateMessage, sendMediaMessage, sendCatalogMessage, sendSingleProductMessage, sendMultiProductMessage, type MultiProductSection } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig, NoWhatsAppConfigError } from '@/lib/whatsapp/resolve-config'
import { MediaPathError, resolveMediaRef as resolveAccountMediaRef } from '@/lib/whatsapp/media-ref'
import {
  maskForLog,
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { emitToAccount } from '@/lib/socket'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import type { MessageTemplate } from '@/types'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { sendSmsText } from '@/lib/messaging/channels/sms'
import { sendAndRecordConversationEmail, cleanSubject, parseAddresses, type EmailMode } from '@/lib/email/conversation-send'
import { sendRcsText } from '@/lib/messaging/channels/rcs'
import { sendToWebsiteVisitor } from '@/lib/webchat/outbound'
import { audit, auditCtx } from '@/lib/audit'
import { stampFirstResponse } from '@/lib/leads/first-response'


// ── Messenger + Instagram (an agent's reply) ─────────────────────────────────
// Host, recipient and Meta's window: src/lib/meta/social-messaging.ts.

const SOCIAL_MESSAGE_TYPES = new Set(['text', 'image', 'video', 'audio', 'document'])

/**
 * A Messenger utility template — allowed after the 24-hour window. The
 * template is loaded with the workspace id and must be approved; the blanks
 * are checked as plain text and must all be filled.
 */
async function handleMessengerTemplateSend(input: {
  accountId: string; userId: string; conversationId: string; contactId: string; templateId: unknown; params: unknown
}): Promise<NextResponse> {
  const id = typeof input.templateId === 'string' && /^[0-9a-f-]{36}$/i.test(input.templateId) ? input.templateId : null
  if (!id) return NextResponse.json({ error: 'Choose a template.' }, { status: 400 })
  const rows = await prisma.$queryRaw<{ name: string; language: string; body: string; param_count: number; status: string }[]>`
    SELECT name, language, body, param_count, status FROM messenger_templates
    WHERE id = ${id}::uuid AND account_id = ${input.accountId}::uuid LIMIT 1`.catch(() => [])
  const t = rows[0]
  if (!t) return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
  if (t.status !== 'approved') return NextResponse.json({ error: 'This template is not approved by Meta yet.' }, { status: 409 })
  const params = checkParams(input.params, t.param_count)
  if (!params.ok) return NextResponse.json({ error: params.error }, { status: 400 })
  let target: SocialTarget
  try {
    target = await loadSocialTarget(input.accountId, input.contactId, 'facebook')
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Messenger is not connected.' }, { status: 400 })
  }
  if (!target.pageId || !/^\d{1,30}$/.test(target.pageId)) return NextResponse.json({ error: 'Run Test Connection for Messenger first.' }, { status: 400 })
  const sent = await sendUtilityTemplate({ pageId: target.pageId, token: target.token, recipientId: target.recipientId, name: t.name, language: t.language, values: params.values })
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 })
  const text = renderTemplate(t.body, params.values)
  const savedMsg = await prisma.message.create({
    data: { conversation_id: input.conversationId, sender_type: 'agent', sender_id: input.userId, content_type: 'template', content_text: text, message_id: sent.messageId, status: 'sent' },
  })
  emitToAccount(input.accountId, 'message', { eventType: 'INSERT', new: savedMsg, old: {} })
  const updatedConv = await prisma.conversation.update({ where: { id: input.conversationId }, data: { last_message_text: text, last_message_at: new Date() } })
  emitToAccount(input.accountId, 'conversation', { eventType: 'UPDATE', new: updatedConv, old: {} })
  return NextResponse.json({ success: true, message_id: savedMsg.id })
}

async function handleSocialSend({
  channel,
  accountId,
  userId,
  conversationId,
  contactId,
  messageType,
  contentText,
  mediaUrl,
}: {
  channel:        SocialChannel
  accountId:      string
  userId:         string
  conversationId: string
  contactId:      string
  messageType:    string
  contentText:    string | null
  mediaUrl:       string | null
}): Promise<NextResponse> {
  const label = channel === 'instagram' ? 'Instagram' : 'Messenger'
  // Checked here, not trusted from the browser or an API key: plain text
  // within Meta's limit, a known type, and a media link that is a string.
  if (!SOCIAL_MESSAGE_TYPES.has(messageType)) {
    return NextResponse.json({ error: `${label} messages can be text, image, video, audio or document.` }, { status: 400 })
  }
  if (contentText !== null && typeof contentText !== 'string') {
    return NextResponse.json({ error: 'The message text must be plain text.' }, { status: 400 })
  }
  if (mediaUrl !== null && (typeof mediaUrl !== 'string' || mediaUrl.length > 2048)) {
    return NextResponse.json({ error: 'The attachment link is not valid.' }, { status: 400 })
  }
  const maxText = channel === 'instagram' ? 1000 : 2000
  if (contentText && contentText.length > maxText) {
    return NextResponse.json({ error: `${label} allows at most ${maxText} characters in one message.` }, { status: 400 })
  }
  let target: SocialTarget
  try {
    target = await loadSocialTarget(accountId, contactId, channel)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : `${label} is not connected.` }, { status: 400 })
  }

  // Meta's window, checked here — not left to Meta's raw error, and API-key
  // sends obey it too.
  const decision = windowDecision(await lastInboundAt(conversationId), new Date(), await humanAgentEnabled(accountId, channel))
  if (!decision.ok) return NextResponse.json({ error: decision.reason, code: 'outside_window' }, { status: 409 })
  const envelope = envelopeFor(decision)

  const isMedia = Boolean(mediaUrl) && ['image', 'video', 'audio', 'document'].includes(messageType)
  if (!isMedia && !contentText?.trim()) {
    return NextResponse.json({ error: 'content_text is required' }, { status: 400 })
  }

  let metaMessageId: string | null
  try {
    if (isMedia) {
      ;({ messageId: metaMessageId } = await socialSendAttachment(target, accountId, messageType as 'image' | 'video' | 'audio' | 'document', mediaUrl as string, envelope))
      // A caption travels as its own text message (attachments carry none).
      if (contentText?.trim()) {
        await socialPost(target, { recipient: { id: target.recipientId }, message: { text: contentText }, ...envelope })
      }
    } else {
      ;({ messageId: metaMessageId } = await socialPost(target, { recipient: { id: target.recipientId }, message: { text: contentText }, ...envelope }))
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : `${label} did not accept the message.` }, { status: 502 })
  }

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: conversationId,
      sender_type:     'agent',
      sender_id:       userId,
      content_type:    messageType,
      content_text:    contentText,
      media_url:       mediaUrl ?? null,
      message_id:      metaMessageId,
      status:          'sent',
    },
  })
  emitToAccount(accountId, 'message', { eventType: 'INSERT', new: savedMsg, old: {} })

  const updatedConv = await prisma.conversation.update({
    where: { id: conversationId },
    data: { last_message_text: contentText ?? `[${messageType}]`, last_message_at: new Date() },
  })
  emitToAccount(accountId, 'conversation', { eventType: 'UPDATE', new: updatedConv, old: {} })

  return NextResponse.json({ success: true, message_id: savedMsg.id })
}

// ── SMS / RCS send helper ─────────────────────────────────────────────────────
// Both channels are phone-addressed, text-only in this phase — one shared
// handler, mirroring handleInstagramSend/handleFacebookSend's shape.
async function handlePhoneChannelSend({
  channel,
  accountId,
  userId,
  conversationId,
  contactPhone,
  contentText,
}: {
  channel:        'sms' | 'rcs'
  accountId:      string
  userId:         string
  conversationId: string
  contactPhone:   string
  contentText:    string
}): Promise<NextResponse> {
  let messageId: string
  try {
    const result = channel === 'sms'
      ? await sendSmsText({ accountId, to: contactPhone, text: contentText })
      : await sendRcsText({ accountId, to: contactPhone, text: contentText })
    messageId = result.messageId || `${channel}_agent_${Date.now()}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : `${channel.toUpperCase()} send failed`
    console.error(`[${channel}/send] error:`, msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: conversationId,
      sender_type:     'agent',
      sender_id:        userId,
      content_type:     'text',
      content_text:     contentText,
      message_id:       messageId,
      status:           'sent',
    },
  })
  emitToAccount(accountId, 'message', { eventType: 'INSERT', new: savedMsg, old: {} })

  const updatedConv = await prisma.conversation.update({
    where: { id: conversationId },
    data: { last_message_text: contentText, last_message_at: new Date() },
  })
  emitToAccount(accountId, 'conversation', { eventType: 'UPDATE', new: updatedConv, old: {} })

  return NextResponse.json({ success: true, message_id: savedMsg.id })
}

// ── Email send helper ─────────────────────────────────────────────────────────
async function handleEmailSend(args: {
  accountId:      string
  userId:         string
  conversationId: string
  contactEmail:   string
  contentText:    string
  mode:           EmailMode
  subject:        string
  replyToMessageId: string | null
  cc:             string[]
  bcc:            string[]
  forwardTo:      string[]
  fileIds:        string[]
  signature:      boolean
  rich:           boolean
}): Promise<NextResponse> {
  if (args.mode === 'new' && !args.subject) {
    return NextResponse.json({ error: 'A new email needs a subject' }, { status: 400 })
  }
  try {
    const savedMsg = await sendAndRecordConversationEmail({
      accountId: args.accountId,
      conversationId: args.conversationId,
      to: args.contactEmail,
      text: args.contentText,
      mode: args.mode,
      subject: args.subject,
      replyToMessageId: args.replyToMessageId,
      cc: args.cc,
      bcc: args.bcc,
      forwardTo: args.forwardTo,
      fileIds: args.fileIds,
      signature: args.signature,
      format: args.rich ? 'rich' : 'plain',
      senderUserId: args.userId,
    })
    return NextResponse.json({ success: true, message_id: savedMsg.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Email send failed'
    console.error('[email/send] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

/** Who sent what — filled in by sendPost once the caller and the
 *  conversation are known, so POST can record message.sent after a 2xx. */
interface SentBy {
  accountId: string
  userId: string
  role: string
  apiKeyId?: string
  conversationId: string
  contactId: string
  channel: string
  messageType: string
  template: string | null
}

/**
 * POST /api/whatsapp/send — a staff member (or an API key) sends one
 * message. Audited as message.sent with the channel and template name
 * only: the body is never recorded (plan §4).
 */
export async function POST(request: Request) {
  let sentBy: SentBy | null = null
  const res = await sendPost(request, (w) => { sentBy = w })
  const who = sentBy as SentBy | null
  if (who && res.status >= 200 && res.status < 300) {
    // A person answered: the contact's open leads get their first
    // response time (reports). Only a signed-in staff member's send
    // counts — an API key is an integration acting under its creator's
    // name, often automatically, so it is not "a person replied".
    // Fire-and-forget: it never fails or slows the send.
    if (!who.apiKeyId) {
      void stampFirstResponse({ accountId: who.accountId, contactId: who.contactId, userId: who.userId })
        .catch((err) => console.error('[send] first response stamp failed:', err instanceof Error ? err.message : err))
    }
    const data = (await res.clone().json().catch(() => null)) as { message_id?: string } | null
    await audit(
      auditCtx(request, { accountId: who.accountId, userId: who.userId, role: who.role, apiKeyId: who.apiKeyId }),
      {
        action: 'message.sent',
        target: { type: 'message', id: data?.message_id ?? null },
        meta: { channel: who.channel, type: who.messageType, template: who.template, conversation_id: who.conversationId },
      },
    )
  }
  return res
}

async function sendPost(request: Request, onSender: (who: SentBy) => void): Promise<Response> {
  try {
    // Accept session auth OR Bearer API key
    const authHeader = request.headers.get('authorization') ?? ''
    let userId: string
    let accountId: string
    // Agents may only send to conversations assigned to them. API key
    // callers have elevated access, so this stays false on that path.
    let isAgent = false
    let senderRole = 'supervisor'
    let apiKeyId: string | undefined

    if (authHeader.startsWith('Bearer wcrm_')) {
      const result = await verifyApiKey(authHeader.slice('Bearer '.length))
      if (!result) {
        return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 })
      }
      // Rate-limit by key prefix for API key sends
      const keyPrefix = authHeader.slice('Bearer '.length, 'Bearer '.length + 12)
      const limit = checkRateLimit(`send-api:${keyPrefix}`, RATE_LIMITS.send)
      if (!limit.success) return rateLimitResponse(limit)

      accountId = result.accountId
      // The key acts as the person who minted it (verifyApiKey confirmed
      // they are still a member at supervisor rank); a key with no
      // recorded creator never gets here (N2). It used to be attributed to
      // the account's earliest member, whoever that happened to be.
      userId = result.creatorUserId
      apiKeyId = result.keyId
    } else {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = session.user.id

      // Per-user rate limit
      const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
      if (!limit.success) return rateLimitResponse(limit)

      const profile = await prisma.profile.findUnique({
        where: { user_id: userId },
        select: { account_id: true, account_role: true },
      })
      accountId = profile?.account_id ?? ''
      if (!profile || !accountId) {
        return NextResponse.json(
          { error: 'Your profile is not linked to an account.' },
          { status: 403 },
        )
      }

      // This route had no role floor: a viewer — read-only by definition,
      // per canSendMessages — could send WhatsApp messages, and because
      // the agent restriction below keys off `role === "agent"` they also
      // skipped the assigned-conversation narrowing that a real agent is
      // held to. So the least privileged role could message ANY
      // conversation in the account.
      if (!isAccountRole(profile.account_role) || !canSendMessages(profile.account_role)) {
        return NextResponse.json(
          { error: 'Your role is read-only — you cannot send messages.' },
          { status: 403 },
        )
      }
      // Agents may only send to conversations explicitly assigned to them.
      // Resolved here from the profile already loaded, rather than
      // re-querying the same row further down.
      isAgent = profile.account_role === 'agent'
      senderRole = profile.account_role
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      media_mime_type,
      media_filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
      catalog_footer_text,
      catalog_thumbnail_retailer_id,
      product_retailer_id,
      catalog_header_text,
      catalog_sections,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    // Telegram's "Ask for number" may come without text — the Telegram
    // branch below supplies the request's wording.
    if (message_type === 'text' && !content_text && body.telegram_ask_number !== true) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    if (message_type === 'catalog' && !content_text) {
      return NextResponse.json({ error: 'content_text (body) is required for catalog messages' }, { status: 400 })
    }
    if (message_type === 'single_product' && !product_retailer_id) {
      return NextResponse.json({ error: 'product_retailer_id is required for single product messages' }, { status: 400 })
    }
    if (message_type === 'multi_product' && (!catalog_header_text || !content_text || !Array.isArray(catalog_sections) || catalog_sections.length === 0)) {
      return NextResponse.json({ error: 'catalog_header_text, content_text, and catalog_sections are required for multi-product messages' }, { status: 400 })
    }

    // Fetch conversation and contact.
    // `isAgent` was resolved during authentication above (alongside the
    // read-only role check), so there's no second profile lookup here.
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversation_id,
        account_id: accountId,
        ...(isAgent ? { assigned_agent_id: userId } : {}),
      },
      include: { contact: true },
    })

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact

    // ── Channel routing ───────────────────────────────────────────────────────
    // Resolved before the phone check below — Email contacts are identified
    // by email, not phone, so the phone requirement must not apply to them.
    const convChannel = (conversation as { channel?: string }).channel ?? 'whatsapp'
    onSender({
      accountId, userId, role: senderRole, apiKeyId,
      conversationId: conversation.id, contactId: conversation.contact_id, channel: convChannel, messageType: String(message_type),
      template: message_type === 'template' && typeof template_name === 'string' ? template_name : null,
    })
    if (body.telegram_ask_number === true && convChannel !== 'telegram') {
      return NextResponse.json({ error: '"Ask for number" works only in a Telegram chat.' }, { status: 400 })
    }

    // Website chat: no provider and no 24-hour window. The reply is
    // recorded and pushed to the visitor's open window; a closed window
    // reads it when it next opens. Text, plus a public https file.
    if (convChannel === 'website') {
      const text = typeof content_text === 'string' ? content_text.trim() : ''
      const isMedia = ['image', 'document', 'video', 'audio'].includes(message_type)
      if (message_type !== 'text' && !isMedia) {
        return NextResponse.json({ error: 'Website chat takes text and files only — no templates or catalogs.' }, { status: 400 })
      }
      if (isMedia && !(typeof media_url === 'string' && media_url.startsWith('https://'))) {
        return NextResponse.json({ error: 'Only files at a public https link can be sent to a website chat.' }, { status: 400 })
      }
      if (!text && !isMedia) {
        return NextResponse.json({ error: 'content_text is required for text messages' }, { status: 400 })
      }
      if (text.length > 4000) {
        return NextResponse.json({ error: 'The message is too long for website chat (4000 characters).' }, { status: 400 })
      }
      const saved = await sendToWebsiteVisitor({
        accountId,
        conversationId: conversation_id,
        senderType: 'agent',
        senderId: userId,
        text,
        contentType: isMedia ? (message_type === 'image' ? 'image' : 'document') : 'text',
        media: isMedia ? { url: media_url, mimeType: message_type === 'image' ? 'image/*' : null } : null,
      })
      return NextResponse.json({ success: true, message_id: saved.id })
    }

    // Telegram: no 24-hour window and no templates. Text, plus a file from
    // the file manager (uploaded to Telegram) or a public https link.
    if (convChannel === 'telegram') {
      const text = typeof content_text === 'string' ? content_text.trim() : ''
      const isMedia = ['image', 'document', 'video', 'audio'].includes(message_type)
      if (message_type !== 'text' && !isMedia) {
        return NextResponse.json({ error: 'Telegram takes text and files only — no templates or catalogs.' }, { status: 400 })
      }
      if (isMedia && !(typeof media_url === 'string' && (media_url.startsWith('https://') || media_url.startsWith('/api/files/')))) {
        return NextResponse.json({ error: 'Only files from the file manager or a public https link can be sent on Telegram.' }, { status: 400 })
      }
      const askForNumber = body.telegram_ask_number === true
      if (!text && !isMedia && !askForNumber) {
        return NextResponse.json({ error: 'content_text is required for text messages' }, { status: 400 })
      }
      if (text.length > 20_000) {
        return NextResponse.json({ error: 'The message is too long (20,000 characters).' }, { status: 400 })
      }
      try {
        const { sendToTelegram } = await import('@/lib/telegram/outbound')
        const saved = await sendToTelegram({
          accountId,
          conversationId: conversation_id,
          senderType: 'agent',
          senderId: userId,
          // The Inbox sends a file's name as its text — on Telegram that is
          // the file's name, not a caption.
          text: isMedia ? '' : text || (askForNumber ? 'Please share your phone number with the button below.' : ''),
          contentType: isMedia ? message_type : 'text',
          media: isMedia
            ? {
                url: media_url,
                mimeType: typeof media_mime_type === 'string' ? media_mime_type : message_type === 'image' ? 'image/jpeg' : null,
                filename: (typeof media_filename === 'string' ? media_filename : text).slice(0, 200) || null,
              }
            : null,
          askForNumber,
        })
        return NextResponse.json({ success: true, message_id: saved.id })
      } catch (err) {
        console.error('[send] telegram failed:', err)
        const { TelegramApiError, TelegramSendError } = await import('@/lib/telegram/outbound')
        const known = err instanceof TelegramApiError || err instanceof TelegramSendError
        return NextResponse.json({ error: known ? (err as Error).message : 'Could not send on Telegram.' }, { status: 502 })
      }
    }

    if (convChannel === 'email') {
      if (!contact?.email) {
        return NextResponse.json({ error: 'Contact has no email address' }, { status: 400 })
      }
      if (message_type !== 'text' || !content_text) {
        return NextResponse.json({ error: 'Only plain text is supported for the Email channel right now' }, { status: 400 })
      }
      if (typeof content_text !== 'string' || content_text.length > 50_000) {
        return NextResponse.json({ error: 'The email is too long' }, { status: 400 })
      }
      // Answering one of their emails is only allowed within this
      // conversation — the id comes from the browser.
      let replyTarget: string | null = null
      if (typeof reply_to_message_id === 'string' && reply_to_message_id) {
        const owned = await prisma.message.findFirst({
          where: { id: reply_to_message_id, conversation_id, sender_type: 'customer' },
          select: { id: true },
        })
        replyTarget = owned?.id ?? null
      }
      const EMAIL_MODES = ['reply', 'reply_all', 'new', 'forward'] as const
      const mode: EmailMode = (EMAIL_MODES as readonly string[]).includes(body.email_mode)
        ? (body.email_mode as EmailMode)
        : 'reply'
      let cc: string[], bcc: string[], forwardTo: string[]
      try {
        cc = parseAddresses(body.email_cc)
        bcc = parseAddresses(body.email_bcc)
        forwardTo = mode === 'forward' ? parseAddresses(body.email_to) : []
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid address' }, { status: 400 })
      }
      const fileIds = Array.isArray(body.attachment_ids)
        ? body.attachment_ids.filter((v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v))
        : []
      return handleEmailSend({
        accountId,
        userId,
        conversationId: conversation_id,
        contactEmail: contact.email,
        contentText: content_text,
        mode,
        subject: cleanSubject(body.email_subject),
        replyToMessageId: replyTarget,
        cc,
        bcc,
        forwardTo,
        fileIds,
        signature: body.email_signature !== false,
        rich: body.email_format === 'rich',
      })
    }

    // Messenger / Instagram contacts are addressed by their PSID / IGSID,
    // not a phone number — handled before the phone check.
    if (convChannel === 'facebook' && message_type === 'messenger_template') {
      return handleMessengerTemplateSend({
        accountId, userId, conversationId: conversation_id, contactId: conversation.contact_id,
        templateId: body.messenger_template_id, params: body.template_params,
      })
    }
    if (convChannel === 'instagram' || convChannel === 'facebook') {
      return handleSocialSend({
        channel: convChannel,
        accountId,
        userId,
        conversationId: conversation_id,
        contactId: conversation.contact_id,
        messageType: message_type,
        contentText: content_text ?? null,
        mediaUrl: media_url ?? null,
      })
    }

    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }
    if (convChannel === 'sms' || convChannel === 'rcs') {
      if (message_type !== 'text' || !content_text) {
        return NextResponse.json({ error: `Only plain text is supported for the ${convChannel.toUpperCase()} channel right now` }, { status: 400 })
      }
      return handlePhoneChannelSend({
        channel: convChannel,
        accountId,
        userId,
        conversationId: conversation_id,
        contactPhone: contact.phone,
        contentText: content_text,
      })
    }

    // Sanitize and validate phone
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Resolve which connected number this send goes out from (Finding
    // #14) — the conversation's own bound number when it has one,
    // falling back to the account's default.
    let config
    try {
      config = await resolveWhatsAppConfig({ accountId, conversationId: conversation_id })
    } catch (err) {
      if (err instanceof NoWhatsAppConfigError) {
        return NextResponse.json(
          { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
          { status: 400 }
        )
      }
      throw err
    }

    const accessToken = decrypt(config.access_token)

    let catalogId: string | null = null
    if (['catalog', 'single_product', 'multi_product'].includes(message_type)) {
      // The catalog of the number this chat is on (one per WhatsApp
      // Business Account), else the default catalog.
      catalogId = await catalogForWaba(accountId, (config as { waba_id?: string | null }).waba_id ?? null)
      if (!catalogId) {
        return NextResponse.json({ error: 'No catalog connected. Connect one in Settings > Catalog first.' }, { status: 400 })
      }
    }

    // Self-heal legacy CBC-encrypted tokens. Fire-and-forget: we
    // return from the send without waiting, so a failed upgrade just
    // means the next send tries again.
    if (isLegacyFormat(config.access_token)) {
      void prisma.whatsAppConfig.update({
        where: { id: config.id },
        data: { access_token: encrypt(accessToken) },
      }).catch((err: unknown) => {
        console.warn(
          '[whatsapp/send] access_token GCM upgrade failed:',
          err instanceof Error ? err.message : err,
        )
      })
    }

    // Resolve the reply target (if any) to its Meta message_id.
    // The parent must belong to this same conversation.
    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const parent = await prisma.message.findFirst({
        where: { id: reply_to_message_id, conversation_id },
        select: { message_id: true, conversation_id: true },
      })

      if (!parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }
      if (!parent.message_id) {
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        )
      } else {
        contextMessageId = parent.message_id
      }
    }

    // For template sends, load the row so sendTemplateMessage can
    // build header + button components from the template definition.
    let templateRow: MessageTemplate | null = null
    if (message_type === 'template' && template_name) {
      const data = await prisma.messageTemplate.findFirst({
        where: {
          account_id: accountId,
          name: template_name,
          language: template_language || 'en_US',
        },
      })
      if (data && !isMessageTemplate(data)) {
        return NextResponse.json(
          {
            error:
              'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
          },
          { status: 500 },
        )
      }
      templateRow = data ?? null
    }

    // For local uploads (/api/files/...) we can't give Meta a localhost URL —
    // instead we upload the file bytes directly to Meta's Media API and use
    // the returned media_id. Public https:// URLs are passed as-is (link).
    type MediaRef = { id: string; link?: never } | { link: string; id?: never }

    // Only this account's own uploads (src/lib/whatsapp/media-ref.ts) —
    // another account's /api/files/account-<id>/ path is refused.
    const resolveMediaRef = async (url: string): Promise<MediaRef> => {
      if (!url) throw new Error('No media URL provided')
      return resolveAccountMediaRef(url, config.phone_number_id, accessToken, accountId)
    }

    // Pre-resolve media so every phone variant reuses the same upload.
    let mediaRef: MediaRef | null = null
    if (['image', 'video', 'document', 'audio'].includes(message_type) && media_url) {
      try {
        mediaRef = await resolveMediaRef(media_url)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[whatsapp/send] media resolve failed:', msg)
        // Our own refusal is worded for people; a file-system or Meta error
        // (paths, upstream bodies) stays in the log.
        const shown = err instanceof MediaPathError ? msg : 'The file could not be read or uploaded to WhatsApp.'
        return NextResponse.json({ error: `Failed to prepare media: ${shown}` }, { status: 400 })
      }
    }

    const attempt = async (phone: string): Promise<string> => {
      if (message_type === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          templateName: template_name,
          language: template_language || 'en_US',
          template: templateRow ?? undefined,
          messageParams: template_message_params ?? undefined,
          params: template_params || [],
          contextMessageId,
          accountId,
        })
        return result.messageId
      }

      if (message_type === 'catalog') {
        const result = await sendCatalogMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          bodyText: content_text,
          footerText: catalog_footer_text || undefined,
          thumbnailProductRetailerId: catalog_thumbnail_retailer_id || undefined,
          contextMessageId,
        })
        return result.messageId
      }

      if (message_type === 'single_product') {
        const result = await sendSingleProductMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          catalogId: catalogId!,
          productRetailerId: product_retailer_id,
          bodyText: content_text || undefined,
          footerText: catalog_footer_text || undefined,
          contextMessageId,
        })
        return result.messageId
      }

      if (message_type === 'multi_product') {
        const sections: MultiProductSection[] = (catalog_sections as Array<{ title?: string; productRetailerIds: string[] }>).map((s) => ({
          title: s.title,
          productRetailerIds: s.productRetailerIds,
        }))
        const result = await sendMultiProductMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          catalogId: catalogId!,
          headerText: catalog_header_text,
          bodyText: content_text,
          footerText: catalog_footer_text || undefined,
          sections,
          contextMessageId,
        })
        return result.messageId
      }

      // Media types: image, video, document, audio
      if (mediaRef) {
        const result = await sendMediaMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          kind: message_type as 'image' | 'video' | 'document' | 'audio',
          ...mediaRef,
          caption: content_text || undefined,
          filename: message_type === 'document' ? (content_text || undefined) : undefined,
          contextMessageId,
        })
        return result.messageId
      }

      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: content_text,
        contextMessageId,
      })
      return result.messageId
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(message)) {
            throw err
          }
          lastError = err
          console.warn(`[whatsapp/send] variant "${variant}" rejected by Meta, trying next…`)
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API send failed for all variants:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 }
      )
    }

    // If a non-original variant succeeded, update the contact so future
    // sends go straight through.
    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[whatsapp/send] Auto-corrected contact phone: ${maskForLog(sanitizedPhone)} → ${maskForLog(workingPhone)}`
      )
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          phone: workingPhone,
          phone_normalized: workingPhone.replace(/\D/g, ''),
        },
      })
    }

    // Insert message into DB
    let messageRecord: { id: string }
    try {
      const fullMsg = await prisma.message.create({
        data: {
          conversation_id,
          sender_type: 'agent',
          sender_id: userId,
          content_type: message_type,
          content_text: content_text || null,
          media_url: media_url || null,
          template_name: template_name || null,
          message_id: waMessageId,
          status: 'sent',
          reply_to_message_id: reply_to_message_id || null,
        },
      })
      messageRecord = fullMsg
      emitToAccount(accountId, 'message', { eventType: 'INSERT', new: fullMsg, old: {} })
    } catch (err) {
      console.error('Error inserting sent message:', err)
      return NextResponse.json(
        { error: 'Message sent to WhatsApp but could not be saved here. Reload the conversation; it may appear after the next sync.' },
        { status: 500 }
      )
    }

    // Update conversation
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation_id },
      data: {
        last_message_text: content_text || `[${message_type}]`,
        last_message_at: new Date(),
      },
    })
    emitToAccount(accountId, 'conversation', { eventType: 'UPDATE', new: updatedConv, old: {} })

    // Pause any active Flow run for this contact — the agent stepping
    // in is the strongest "yield, human is here" signal.
    try {
      await prisma.flowRun.updateMany({
        where: {
          account_id: accountId,
          contact_id: contact.id,
          status: 'active',
        },
        data: {
          status: 'paused_by_agent',
          ended_at: new Date(),
          end_reason: 'agent_replied',
        },
      })
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
