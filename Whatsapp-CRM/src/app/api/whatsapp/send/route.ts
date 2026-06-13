import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join, basename } from 'path'
import { lookup as mimeLookup } from 'mime-types'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { sendTextMessage, sendTemplateMessage, sendMediaMessage, uploadMediaToMeta } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import type { MessageTemplate } from '@/types'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'

const UPLOADS_DIR = join(process.cwd(), 'uploads')

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = session.user.id

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Resolve the caller's account_id. Every downstream lookup
    // (conversation, whatsapp_config, message_templates) is account-
    // scoped post-multi-user, so the previous `user_id` filters
    // returned nothing for teammates who didn't author the row.
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    const accountId = profile?.account_id
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
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

    // Fetch conversation and contact
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversation_id, account_id: accountId },
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
      messageRecord = await prisma.message.create({
        data: {
          conversation_id,
          sender_type: 'agent',
          content_type: message_type,
          content_text: content_text || null,
          media_url: media_url || null,
          template_name: template_name || null,
          message_id: waMessageId,
          status: 'sent',
          reply_to_message_id: reply_to_message_id || null,
        },
        select: { id: true },
      })
    } catch (err) {
      console.error('Error inserting sent message:', err)
      return NextResponse.json(
        { error: `Message sent to Meta but failed to save to DB: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      )
    }

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation_id },
      data: {
        last_message_text: content_text || `[${message_type}]`,
        last_message_at: new Date(),
      },
    })

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
