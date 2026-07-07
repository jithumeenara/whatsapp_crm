import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join, basename } from 'path'
import { lookup as mimeLookup } from 'mime-types'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { verifyApiKey } from '@/lib/auth/api-key'
import { sendTextMessage, sendTemplateMessage, sendMediaMessage, uploadMediaToMeta } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import {
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

const UPLOADS_DIR = join(process.cwd(), 'uploads')

// ── Instagram send helper ─────────────────────────────────────────────────────
type IgConfigRow = { access_token: string | null }

async function handleInstagramSend({
  accountId,
  userId,
  conversationId,
  contactIgsid,
  messageType,
  contentText,
  mediaUrl,
}: {
  accountId:     string
  userId:        string
  conversationId: string
  contactIgsid:  string
  messageType:   string
  contentText:   string | null
  mediaUrl:      string | null
}): Promise<NextResponse> {
  // Load Instagram config
  const rows = await prisma.$queryRaw<IgConfigRow[]>`
    SELECT access_token FROM instagram_config WHERE account_id = ${accountId}::uuid LIMIT 1
  `.catch(() => [] as IgConfigRow[])

  const token = rows[0]?.access_token
  if (!token) {
    return NextResponse.json(
      { error: 'Instagram not configured. Set up Instagram in Settings → Instagram.' },
      { status: 400 }
    )
  }

  // Build message payload
  type IgPayload = {
    recipient: { id: string }
    message:
      | { text: string }
      | { attachment: { type: string; payload: { url: string } } }
  }

  let message: IgPayload['message']
  if (mediaUrl && ['image', 'video', 'audio', 'document'].includes(messageType)) {
    const publicUrl = mediaUrl.startsWith('/')
      ? `${process.env.NEXTAUTH_URL ?? ''}${mediaUrl}`
      : mediaUrl
    message = {
      attachment: {
        type: messageType === 'document' ? 'file' : messageType,
        payload: { url: publicUrl },
      },
    }
  } else {
    if (!contentText) {
      return NextResponse.json({ error: 'content_text is required' }, { status: 400 })
    }
    message = { text: contentText }
  }

  const igRes = await fetch(
    `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: contactIgsid }, message }),
    }
  )

  const igData = await igRes.json() as { message_id?: string; error?: { message: string } }

  if (!igRes.ok || igData.error) {
    const msg = igData.error?.message ?? `Instagram API error ${igRes.status}`
    console.error('[instagram/send] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Persist message to DB
  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: conversationId,
      sender_type:     'agent',
      sender_id:       userId,
      content_type:    messageType,
      content_text:    contentText,
      media_url:       mediaUrl ?? null,
      message_id:      igData.message_id ?? null,
      status:          'sent',
    },
  })
  emitToAccount(accountId, 'message', { eventType: 'INSERT', new: savedMsg, old: {} })

  const updatedConv = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      last_message_text: contentText ?? `[${messageType}]`,
      last_message_at:   new Date(),
    },
  })
  emitToAccount(accountId, 'conversation', { eventType: 'UPDATE', new: updatedConv, old: {} })

  return NextResponse.json({ success: true, message_id: savedMsg.id })
}

// ── Facebook Messenger send helper ───────────────────────────────────────────
type FbConfigRow = { access_token: string | null }

async function handleFacebookSend({
  accountId,
  userId,
  conversationId,
  contactPsid,
  messageType,
  contentText,
  mediaUrl,
}: {
  accountId:      string
  userId:         string
  conversationId: string
  contactPsid:    string
  messageType:    string
  contentText:    string | null
  mediaUrl:       string | null
}): Promise<NextResponse> {
  const rows = await prisma.$queryRaw<FbConfigRow[]>`
    SELECT access_token FROM facebook_config WHERE account_id = ${accountId}::uuid LIMIT 1
  `.catch(() => [] as FbConfigRow[])

  const token = rows[0]?.access_token
  if (!token) {
    return NextResponse.json(
      { error: 'Facebook not configured. Set up Facebook in Settings → Facebook.' },
      { status: 400 }
    )
  }

  type FbPayload = {
    recipient: { id: string }
    message: { text: string } | { attachment: { type: string; payload: { url: string; is_reusable: boolean } } }
  }

  let message: FbPayload['message']
  if (mediaUrl && ['image', 'video', 'audio', 'document'].includes(messageType)) {
    const publicUrl = mediaUrl.startsWith('/')
      ? `${process.env.NEXTAUTH_URL ?? ''}${mediaUrl}`
      : mediaUrl
    message = {
      attachment: {
        type: messageType === 'document' ? 'file' : messageType,
        payload: { url: publicUrl, is_reusable: true },
      },
    }
  } else {
    if (!contentText) return NextResponse.json({ error: 'content_text is required' }, { status: 400 })
    message = { text: contentText }
  }

  const fbRes = await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: contactPsid }, message }),
    }
  )

  const fbData = await fbRes.json() as { message_id?: string; error?: { message: string } }
  if (!fbRes.ok || fbData.error) {
    const msg = fbData.error?.message ?? `Facebook API error ${fbRes.status}`
    console.error('[facebook/send] error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const savedMsg = await prisma.message.create({
    data: {
      conversation_id: conversationId,
      sender_type:     'agent',
      sender_id:       userId,
      content_type:    messageType,
      content_text:    contentText,
      media_url:       mediaUrl ?? null,
      message_id:      fbData.message_id ?? null,
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

export async function POST(request: Request) {
  try {
    // Accept session auth OR Bearer API key
    const authHeader = request.headers.get('authorization') ?? ''
    let userId: string
    let accountId: string
    let isApiKey = false

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
      // Use account owner as sender for API key calls
      const owner = await prisma.profile.findFirst({
        where: { account_id: accountId },
        orderBy: { created_at: 'asc' },
        select: { user_id: true },
      })
      if (!owner) {
        return NextResponse.json({ error: 'Account has no members.' }, { status: 403 })
      }
      userId = owner.user_id
      isApiKey = true
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
        select: { account_id: true },
      })
      accountId = profile?.account_id ?? ''
      if (!accountId) {
        return NextResponse.json(
          { error: 'Your profile is not linked to an account.' },
          { status: 403 },
        )
      }
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    if (message_type === 'text' && !content_text) {
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

    // Fetch conversation and contact.
    // API key callers have elevated access — no agent restriction.
    // Session callers: agents may only send to their assigned conversations.
    let isAgent = false
    if (!isApiKey) {
      const callerProfile = await prisma.profile.findUnique({
        where: { user_id: userId },
        select: { account_role: true },
      })
      isAgent = callerProfile?.account_role === "agent"
    }

    // Agents may only send to conversations explicitly assigned to them.
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
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    // ── Channel routing ───────────────────────────────────────────────────────
    const convChannel = (conversation as { channel?: string }).channel ?? 'whatsapp'
    if (convChannel === 'instagram') {
      return handleInstagramSend({
        accountId,
        userId,
        conversationId: conversation_id,
        contactIgsid: contact.phone,
        messageType: message_type,
        contentText: content_text ?? null,
        mediaUrl: media_url ?? null,
      })
    }
    if (convChannel === 'facebook') {
      return handleFacebookSend({
        accountId,
        userId,
        conversationId: conversation_id,
        contactPsid: contact.phone,
        messageType: message_type,
        contentText: content_text ?? null,
        mediaUrl: media_url ?? null,
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

    // Fetch and decrypt WhatsApp config
    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: accountId },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

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

    const resolveMediaRef = async (url: string): Promise<MediaRef> => {
      if (!url) throw new Error('No media URL provided')

      // Already a public URL — pass straight to Meta as a link
      if (url.startsWith('http')) return { link: url }

      // Local upload path: /api/files/<account-dir>/<filename>
      const relativePath = url.replace(/^\/api\/files\//, '')
      const filePath = join(UPLOADS_DIR, relativePath)
      if (!filePath.startsWith(UPLOADS_DIR)) throw new Error('Invalid file path')

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
      return { id: mediaId }
    }

    // Pre-resolve media so every phone variant reuses the same upload.
    let mediaRef: MediaRef | null = null
    if (['image', 'video', 'document', 'audio'].includes(message_type) && media_url) {
      try {
        mediaRef = await resolveMediaRef(media_url)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[whatsapp/send] media resolve failed:', msg)
        return NextResponse.json({ error: `Failed to prepare media: ${msg}` }, { status: 400 })
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
        `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
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
        { error: `Message sent to Meta but failed to save to DB: ${err instanceof Error ? err.message : String(err)}` },
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
