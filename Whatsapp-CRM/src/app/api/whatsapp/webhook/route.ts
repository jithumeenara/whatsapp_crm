import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  /**
   * Present when the customer taps a quick-reply button on a template message.
   * (Distinct from `interactive` which is for interactive list/button messages.)
   */
  button?: { payload: string; text: string }
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
      }>
    }
    field: string
  }>
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch all whatsapp configs to check verify tokens
    let configs: { id: string; verify_token: string | null }[]
    try {
      configs = await prisma.whatsAppConfig.findMany({
        select: { id: true, verify_token: true },
      })
    } catch (err) {
      console.error('Error fetching configs for verification:', err)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    let matchedConfig: { id: string; verify_token: string | null } | null = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (matchedConfig.verify_token && isLegacyFormat(matchedConfig.verify_token)) {
        void prisma.whatsAppConfig.update({
          where: { id: matchedConfig.id },
          data: { verify_token: encrypt(verifyToken) },
        }).catch((err: unknown) => {
          console.warn(
            '[webhook] verify_token GCM upgrade failed:',
            err instanceof Error ? err.message : err,
          )
        })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // 401 (not 200) — we want Meta's delivery dashboard to show failures
    // loudly if a misconfiguration causes signatures to stop matching,
    // rather than silently eating events.
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process asynchronously so we can ack Meta within their timeout.
  processWebhook(body).catch((error) => {
    console.error('Error processing webhook:', error)
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Template-lifecycle events (status / quality / components
      // updates from Meta) come in on a different change.field and
      // have a different value shape — route them through the
      // dedicated handler.
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
        )
        continue
      }

      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id. Distinguish 0-rows from
      // ≥2 rows so operators see the real cause in logs.
      let configRows: {
        id: string
        account_id: string
        user_id: string
        access_token: string
        phone_number_id: string
      }[]
      try {
        configRows = await prisma.whatsAppConfig.findMany({
          where: { phone_number_id: phoneNumberId },
          select: {
            id: true,
            account_id: true,
            user_id: true,
            access_token: true,
            phone_number_id: true,
          },
        })
      } catch (err) {
        console.error(
          'Error fetching whatsapp_config for phone_number_id:',
          phoneNumberId,
          err
        )
        continue
      }

      if (!configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      if (configRows.length > 1) {
        console.error(
          `Multiple configs (${configRows.length}) found for phone_number_id:`,
          phoneNumberId,
          '— inbound message dropped. Resolve duplicates so each number maps to a single account.',
          'Account owners:',
          configRows.map((r) => `${r.account_id} (admin ${r.user_id})`)
        )
        continue
      }

      const config = configRows[0]
      const decryptedAccessToken = decrypt(config.access_token)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          // Tenancy — drives every contact / conversation lookup
          // and the engines' active-row dispatch.
          config.account_id,
          // Audit / sender-of-record — used as the user_id on row
          // inserts that need it for NOT NULL FK compliance. Always
          // the admin who saved the WhatsApp config.
          config.user_id,
          decryptedAccessToken
        )
      }
    }
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Can a recipient transition from `current` to `incoming`?
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}) {
  // 1) Mirror onto messages (legacy behavior)
  try {
    await prisma.message.updateMany({
      where: { message_id: status.id },
      data: { status: status.status },
    })
  } catch (err) {
    console.error('Error updating message status:', err)
  }

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  const tsIso = new Date(parseInt(status.timestamp) * 1000)

  let recipient: { id: string; status: string; broadcast_id: string } | null
  try {
    recipient = await prisma.broadcastRecipient.findUnique({
      where: { whatsapp_message_id: status.id },
      select: { id: true, status: true, broadcast_id: true },
    })
  } catch (err) {
    console.error('Error fetching broadcast recipient:', err)
    return
  }
  if (!recipient) return // message wasn't part of a broadcast — fine

  // Guard transitions — forward-only on the success ladder.
  if (!isValidStatusTransition(recipient.status, status.status)) return

  const update: Record<string, unknown> = { status: status.status }
  if (status.status === 'sent') update.sent_at = tsIso
  if (status.status === 'delivered') update.delivered_at = tsIso
  if (status.status === 'read') update.read_at = tsIso

  try {
    await prisma.broadcastRecipient.update({
      where: { id: recipient.id },
      data: update,
    })
  } catch (err) {
    console.error('Error updating broadcast recipient status:', err)
    return
  }

  // Increment the aggregate count on the parent Broadcast row so the
  // detail page stats reflect reality without requiring a full recount.
  const countField: Record<string, string> = {
    sent: 'sent_count',
    delivered: 'delivered_count',
    read: 'read_count',
    replied: 'replied_count',
    failed: 'failed_count',
  }
  const field = countField[status.status]
  if (field) {
    try {
      await prisma.broadcast.update({
        where: { id: recipient.broadcast_id },
        data: { [field]: { increment: 1 } },
      })
    } catch (err) {
      console.error('Error incrementing broadcast count:', err)
    }
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet.
    const rec = await prisma.broadcastRecipient.findFirst({
      where: {
        contact_id: contactId,
        status: { in: ['sent', 'delivered', 'read'] },
        broadcast: { account_id: accountId },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, status: true },
    })

    if (!rec) return

    const updated = await prisma.broadcastRecipient.update({
      where: { id: rec.id },
      data: { status: 'replied', replied_at: new Date() },
      select: { broadcast_id: true },
    })
    await prisma.broadcast.update({
      where: { id: updated.broadcast_id },
      data: { replied_count: { increment: 1 } },
    })
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent.
 */
async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  try {
    const row = await prisma.message.findFirst({
      where: { message_id: metaId, conversation_id: conversationId },
      select: { id: true },
    })
    return row?.id ?? null
  } catch (err) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 */
async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    try {
      await prisma.messageReaction.deleteMany({
        where: {
          message_id: targetInternalId,
          actor_type: 'customer',
          actor_id: contactId,
        },
      })
    } catch (err) {
      console.error('[webhook] reaction delete failed:', err instanceof Error ? err.message : err)
    }
    return
  }

  try {
    await prisma.messageReaction.upsert({
      where: {
        message_id_actor_type_actor_id: {
          message_id: targetInternalId,
          actor_type: 'customer',
          actor_id: contactId,
        },
      },
      create: {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      update: { emoji: reaction.emoji },
    })
  } catch (err) {
    console.error('[webhook] reaction upsert failed:', err instanceof Error ? err.message : err)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  // Tenancy. Resolved from the matched whatsapp_config row.
  accountId: string,
  // Sender-of-record for inserts that need a NOT NULL user_id FK.
  configOwnerUserId: string,
  accessToken: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const conversation = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id
  )
  if (!conversation) return

  // Reactions short-circuit here — they aren't messages.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // Parse message content based on type
  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken)

  // Resolve swipe-reply context if present.
  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  // `mediaType` is intentionally unused — the schema has no media_type column.
  void mediaType

  // The messages.content_type CHECK constraint allows:
  //   text, image, document, audio, video, location, template, interactive
  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'       // stickers are images
      : message.type === 'button'
        ? 'interactive' // template quick-reply tap → show as interactive/button reply
        : 'text'        // reaction, unknown → text fallback

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate.
  const priorCustomerMsgCount = await prisma.message.count({
    where: {
      conversation_id: conversation.id,
      sender_type: 'customer',
    },
  })
  const isFirstInboundMessage = priorCustomerMsgCount === 0

  try {
    await prisma.message.create({
      data: {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: message.id,
        status: 'delivered',
        created_at: new Date(parseInt(message.timestamp) * 1000),
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: interactiveReplyId,
      },
    })
  } catch (err) {
    console.error('Error inserting message:', err)
    return
  }

  // Update conversation
  try {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        last_message_text: contentText || `[${message.type}]`,
        last_message_at: new Date(),
        unread_count: (conversation.unread_count || 0) + 1,
      },
    })
  } catch (err) {
    console.error('Error updating conversation:', err)
  }

  // If this contact was a recent broadcast recipient, flag the reply.
  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  // ============================================================
  // Flow runner dispatch.
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const inboundText = contentText ?? message.text?.body ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  // accessToken is kept in the signature for future use (e.g. eager download)
  // but the media proxy fetches it on demand, so we don't need it here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  interactiveReplyId: string | null
}> {
  // Return a proxy URL without calling Meta at webhook time.
  // The /api/whatsapp/media/[mediaId] route fetches the real download URL
  // on demand, which avoids storing stale CDN URLs and eliminates this
  // as a failure point when processing the inbound webhook.
  const proxyUrl = (mediaId: string) => `/api/whatsapp/media/${mediaId}`

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await proxyUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await proxyUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await proxyUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await proxyUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await proxyUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    // Customer tapped a quick-reply button on a template message.
    // Meta sends type:"button" with { button: { text, payload } }.
    case 'button': {
      const btn = message.button
      if (btn?.text) {
        return {
          ...empty,
          contentText: btn.text,
          interactiveReplyId: btn.payload || null,
        }
      }
      return { ...empty, contentText: '[Button reply]' }
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch in processMessage. */
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  // Find an existing contact for this account by phone.
  const existingContact = await findExistingContact(
    accountId,
    phone,
  )

  if (existingContact) {
    // Update name if it changed
    if (name && name !== existingContact.name) {
      await prisma.contact.update({
        where: { id: existingContact.id },
        data: { name },
      }).catch((err: unknown) => {
        console.warn('[webhook] contact name update failed:', err instanceof Error ? err.message : err)
      })
    }
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact.
  try {
    const newContact = await prisma.contact.create({
      data: {
        account_id: accountId,
        user_id: configOwnerUserId,
        phone,
        phone_normalized: phone.replace(/\D/g, ''),
        name: name || phone,
      },
    })
    return { contact: newContact, wasCreated: true }
  } catch (err: unknown) {
    // Lost a race: a concurrent inbound delivery created this contact
    // between our lookup and insert. Re-resolve the existing row.
    if (isUniqueViolation(err)) {
      const raced = await findExistingContact(accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', err)
    return null
  }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  // Look for existing conversation in this account
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId },
  })

  if (existing) {
    return existing
  }

  // Create new conversation.
  try {
    return await prisma.conversation.create({
      data: {
        account_id: accountId,
        user_id: configOwnerUserId,
        contact_id: contactId,
      },
    })
  } catch (err) {
    console.error('Error creating conversation:', err)
    return null
  }
}
