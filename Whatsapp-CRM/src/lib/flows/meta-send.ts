import { readFile } from 'fs/promises'
import { join, basename } from 'path'
import { lookup as mimeLookup } from 'mime-types'
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
  sendFlowMessage,
  uploadMediaToMeta,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

const UPLOADS_DIR = join(process.cwd(), 'uploads')
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

/**
 * Instagram Sender Actions — typing_on, typing_off, mark_seen.
 * Fire-and-forget: errors are swallowed so they never block the main message send.
 */
async function sendIgSenderAction(
  igsid: string,
  token: string,
  action: 'typing_on' | 'typing_off' | 'mark_seen',
) {
  await fetch(
    `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: igsid }, sender_action: action }),
    }
  ).catch((e) => console.warn('[sendIgSenderAction] non-critical error:', e?.message))
}

async function engineSendTextInstagram(args: SendTextEngineArgs): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, account_id: args.accountId },
    select: { phone: true },
  })
  if (!contact?.phone) throw new Error('Instagram contact not found')

  const rows = await prisma.$queryRaw<{ access_token: string }[]>`
    SELECT access_token FROM instagram_config WHERE account_id = ${args.accountId}::uuid LIMIT 1
  `
  const token = rows[0]?.access_token
  if (!token) throw new Error('Instagram not configured for this account')

  // Show typing indicator before sending (natural conversational feel)
  await sendIgSenderAction(contact.phone, token, 'typing_on')

  const igText = convertMarkdownForInstagram(args.text)
  const body = {
    recipient: { id: contact.phone },
    message: { text: igText },
    messaging_type: 'RESPONSE',  // required per Meta docs for replies within 24h window
  }
  console.log('[engineSendTextInstagram] sending to IGSID:', contact.phone, '| text:', igText.slice(0, 50))
  const res = await fetch(
    `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  const data = await res.json() as { message_id?: string; recipient_id?: string; error?: { message: string; code?: number; error_subcode?: number; fbtrace_id?: string } }
  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `Instagram send failed: ${res.status}`
    console.error('[engineSendTextInstagram] API error:', JSON.stringify(data), '| accountId:', args.accountId, '| igsid:', contact.phone)
    throw new Error(msg)
  }
  console.log('[engineSendTextInstagram] sent OK. message_id:', data.message_id, '| recipient_id:', data.recipient_id)

  const igMid = data.message_id ?? `ig_bot_${Date.now()}`
  await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: 'text', content_text: args.text, message_id: igMid, status: 'sent' },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.text, last_message_at: new Date() },
  })
  return { whatsapp_message_id: igMid }
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  // Use raw SQL to read channel — avoids requiring prisma generate after schema change
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  const channel = convRows[0]?.channel

  if (channel === 'instagram') return engineSendTextInstagram(args)

  // Safety net: if channel is NULL, check if contact phone looks like an IGSID
  // (pure numeric, no '+' prefix — won't collide with valid E.164 numbers)
  if (!channel) {
    const contactRow = await prisma.contact.findFirst({
      where: { id: args.contactId },
      select: { phone: true },
    })
    if (contactRow?.phone && /^\d+$/.test(contactRow.phone) && !contactRow.phone.startsWith('+')) {
      console.warn('[engineSendText] channel NULL but phone looks like IGSID — routing to Instagram')
      return engineSendTextInstagram(args)
    }
  }

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
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  if (convRows[0]?.channel === 'instagram') return engineSendIgMedia(args)

  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId)
  const accessToken = decrypt(config.access_token)

  // Resolve local /api/files/… uploads to a Meta media_id so the chatbot
  // engine can send them even when the server isn't publicly reachable.
  type MediaRef = { id: string; link?: never } | { link: string; id?: never }
  let mediaRef: MediaRef
  if (args.link.startsWith('http')) {
    mediaRef = { link: args.link }
  } else {
    const relativePath = args.link.replace(/^\/api\/files\//, '')
    const filePath = join(UPLOADS_DIR, relativePath)
    if (!filePath.startsWith(UPLOADS_DIR)) throw new Error('Invalid media file path')
    const fileBuffer = await readFile(filePath)
    const filename = basename(relativePath)
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
  await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: args.kind, content_text: args.caption ?? null, message_id: waMessageId, status: 'sent' },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: new Date() },
  })
  return { whatsapp_message_id: waMessageId }
}

async function engineSendIgMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, account_id: args.accountId },
    select: { phone: true },
  })
  if (!contact?.phone) throw new Error('Instagram contact not found')

  const rows = await prisma.$queryRaw<{ access_token: string }[]>`
    SELECT access_token FROM instagram_config WHERE account_id = ${args.accountId}::uuid LIMIT 1
  `
  const token = rows[0]?.access_token
  if (!token) throw new Error('Instagram not configured for this account')

  // Instagram media attachment types: image, audio, video, file
  const igType = args.kind === 'document' ? 'file' : args.kind

  let res: Response
  let resolvedUrl: string

  if (args.link.startsWith('http')) {
    // Public URL — send directly (works in production with a real domain)
    resolvedUrl = args.link
    console.log('[engineSendIgMedia] IGSID:', contact.phone, '| type:', igType, '| url:', resolvedUrl.slice(0, 80))
    await sendIgSenderAction(contact.phone, token, 'typing_on')
    res = await fetch(
      `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: contact.phone },
          message: { attachment: { type: igType, payload: { url: resolvedUrl, is_reusable: true } } },
          messaging_type: 'RESPONSE',
        }),
      }
    )
  } else {
    // Local file — read from disk and POST as multipart form-data.
    // This bypasses the need for a publicly reachable URL (works with ngrok/localhost).
    const relativePath = args.link.replace(/^\/api\/files\//, '')
    const filePath = join(UPLOADS_DIR, relativePath)
    if (!filePath.startsWith(UPLOADS_DIR)) throw new Error('Invalid media path')
    const fileBuffer = await readFile(filePath)
    const filename = basename(relativePath)
    const mimeType = (mimeLookup(filename) || 'application/octet-stream') as string
    resolvedUrl = args.link

    console.log('[engineSendIgMedia] IGSID:', contact.phone, '| type:', igType, '| multipart upload:', filename, mimeType)
    await sendIgSenderAction(contact.phone, token, 'typing_on')

    const form = new FormData()
    form.append('recipient', JSON.stringify({ id: contact.phone }))
    form.append('message', JSON.stringify({ attachment: { type: igType, payload: { is_reusable: true } } }))
    form.append('filedata', new Blob([fileBuffer], { type: mimeType }), filename)
    form.append('messaging_type', 'RESPONSE')

    res = await fetch(
      `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', body: form }
    )
  }

  const data = await res.json() as { message_id?: string; error?: { message: string; code?: number } }
  if (!res.ok || data.error) {
    console.error('[engineSendIgMedia] API error:', JSON.stringify(data))
    throw new Error(data.error?.message ?? `Instagram media send failed: ${res.status}`)
  }

  const igMid = data.message_id ?? `ig_media_${Date.now()}`
  const preview = args.caption ?? `[${args.kind}]`
  await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: args.kind, content_text: preview, media_url: args.link, message_id: igMid, status: 'sent' },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: new Date() },
  })
  return { whatsapp_message_id: igMid }
}

export async function engineSendTemplate(
  args: SendTemplateEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId)
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
            },
          }
        : { params }),
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
}

export async function engineSendFlow(
  args: SendFlowEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { contact, sanitized, config } = await resolveContactAndConfig(args.accountId, args.contactId)
  const accessToken = decrypt(config.access_token)

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
    }).then((r) => r.messageId)
  )

  const preview = args.bodyText ?? `[Flow: ${args.flowCta}]`
  await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'interactive',
      content_text: preview,
      message_id: waMessageId,
      status: 'sent',
    },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: preview, last_message_at: new Date() },
  })
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
  const config = await prisma.whatsAppConfig.findUnique({ where: { account_id: args.accountId } })
  if (!config) throw new Error('WhatsApp not configured for this account')

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
  if (convRows[0]?.channel === 'instagram') {
    return engineSendIgButtonTemplate(args)
  }
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

// Instagram Button Template (official Meta API for branching buttons in chatbots).
// Uses "postback" buttons — when tapped, Instagram fires a messaging_postbacks
// webhook event (NOT a messages event). The postback.payload = button id (reply_id).
async function engineSendIgButtonTemplate(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, account_id: args.accountId },
    select: { phone: true },
  })
  if (!contact?.phone) throw new Error('Instagram contact not found')

  const rows = await prisma.$queryRaw<{ access_token: string }[]>`
    SELECT access_token FROM instagram_config WHERE account_id = ${args.accountId}::uuid LIMIT 1
  `
  const token = rows[0]?.access_token
  if (!token) throw new Error('Instagram not configured for this account')

  // Show typing indicator before sending
  await sendIgSenderAction(contact.phone, token, 'typing_on')

  // Button Template supports 1–3 postback buttons.
  // InteractiveButton.id = the original reply_id set in the node config.
  const buttons = args.buttons.slice(0, 3).map((b) => ({
    type: 'postback',
    title: b.title.slice(0, 20),
    payload: b.id,
  }))

  const body = {
    recipient: { id: contact.phone },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: (args.bodyText ?? '').slice(0, 640) || 'Choose an option:',
          buttons,
        },
      },
    },
    messaging_type: 'RESPONSE',
  }

  console.log('[engineSendIgButtonTemplate] IGSID:', contact.phone, '| buttons:', buttons.length, '| text:', args.bodyText?.slice(0, 40))

  const res = await fetch(
    `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  const data = await res.json() as { message_id?: string; error?: { message: string; code?: number } }
  if (!res.ok || data.error) {
    console.error('[engineSendIgButtonTemplate] API error:', JSON.stringify(data))
    throw new Error(data.error?.message ?? `Instagram button template failed: ${res.status}`)
  }
  console.log('[engineSendIgButtonTemplate] sent OK, mid:', data.message_id)

  const igMid = data.message_id ?? `ig_btn_${Date.now()}`
  await prisma.message.create({
    data: { conversation_id: args.conversationId, sender_type: 'bot', content_type: 'text', content_text: args.bodyText, message_id: igMid, status: 'sent' },
  })
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: args.bodyText, last_message_at: new Date() },
  })
  return { whatsapp_message_id: igMid }
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  // Instagram doesn't support list messages — fall back to plain text with options listed
  const convRows = await prisma.$queryRaw<{ channel: string | null }[]>`
    SELECT channel FROM conversations WHERE id = ${args.conversationId}::uuid LIMIT 1
  `.catch(() => [] as { channel: string | null }[])
  if (convRows[0]?.channel === 'instagram') {
    const items = args.sections.flatMap((s) => s.rows).map((r, i) => `${i + 1}. ${r.title}`).join('\n')
    const fallbackText = `${args.bodyText ?? ''}\n\n${items}`.trim()
    return engineSendText({ ...args, text: fallbackText })
  }
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
