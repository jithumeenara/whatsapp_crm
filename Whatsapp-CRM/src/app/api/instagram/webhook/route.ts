import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe"
import { dispatchInboundToFlows } from "@/lib/flows/engine"

type RawConfig = {
  account_id: string
  access_token: string | null
  verify_token: string | null
  instagram_account_id: string | null
  page_id: string | null
}

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  try {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS instagram_config (
        id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id           UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        access_token         TEXT,
        verify_token         TEXT,
        instagram_account_id TEXT,
        page_id              TEXT,
        status               TEXT        NOT NULL DEFAULT 'disconnected',
        ig_username          TEXT,
        ig_name              TEXT,
        last_tested_at       TIMESTAMPTZ,
        test_error           TEXT,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
  } catch { /* table already exists */ }
  tableReady = true
}

// Warm up at module load so the GET verify handler responds instantly
void ensureTable()

// ── GET — webhook verification ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get("hub.mode")
  const token     = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode !== "subscribe" || !token || !challenge) {
    return new NextResponse("Bad request", { status: 400 })
  }

  if (process.env.INSTAGRAM_VERIFY_TOKEN && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }

  try {
    await ensureTable()
    const rows = await prisma.$queryRaw<RawConfig[]>`
      SELECT account_id, access_token, verify_token, instagram_account_id, page_id
      FROM instagram_config
      WHERE verify_token = ${token}
      LIMIT 1
    `
    if (rows[0]) {
      return new NextResponse(challenge, { status: 200 })
    }
  } catch (err) {
    console.error("[Instagram Webhook] DB error during verify:", err)
  }

  console.error(`[Instagram Webhook] Verify token not found: "${token}"`)
  return new NextResponse("Forbidden", { status: 403 })
}

// ── POST — receive messages from Instagram ────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    if (!raw.trim()) return NextResponse.json({ status: "ok" })
    const body = JSON.parse(raw) as IgWebhookBody

    if (body.object !== "instagram") {
      return NextResponse.json({ status: "ignored" })
    }

    // Process async so Meta gets a fast 200
    processInstagramWebhook(body).catch((err) =>
      console.error("[Instagram Webhook] processInstagramWebhook error:", err)
    )

    return NextResponse.json({ status: "ok" })
  } catch (err) {
    console.error("[Instagram Webhook Error]", err)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}

interface IgMessagingEvent {
  sender:    { id: string }
  recipient: { id: string }
  timestamp: number | string
  message?: {
    mid: string
    text?: string
    attachments?: Array<{ type: string; payload: { url?: string } }>
    is_echo?: boolean
    quick_reply?: { payload: string }
  }
  // Button Template tap fires messaging_postbacks (not messages)
  postback?: {
    title: string
    payload: string
    mid?: string
  }
  read?:     { watermark: number }
  delivery?: { watermark: number }
}

interface IgWebhookBody {
  object: string
  entry: Array<{
    id: string   // Instagram Account ID (recipient) — "0" in test payloads
    time?: number
    // Changes format (what Meta actually sends for Instagram)
    changes?: Array<{
      field: string   // "messages" | "messaging_postbacks" | "messaging_reactions" | etc.
      value: IgMessagingEvent & { sender: { id: string }; recipient: { id: string }; timestamp: number | string }
    }>
    // Messaging format (legacy, kept for compatibility)
    messaging?: IgMessagingEvent[]
  }>
}

async function processInstagramWebhook(body: IgWebhookBody) {
  await ensureTable()

  for (const entry of body.entry ?? []) {
    const entryAccountId = entry.id  // may be "0" for Meta test payloads

    // Look up config — for real messages entry.id = our Instagram Account ID.
    // For Meta test payloads (id="0"), fall back to the first config found.
    let config: RawConfig | undefined

    if (entryAccountId && entryAccountId !== "0") {
      const rows = await prisma.$queryRaw<RawConfig[]>`
        SELECT account_id, access_token, verify_token, instagram_account_id, page_id
        FROM instagram_config
        WHERE instagram_account_id = ${entryAccountId}
           OR page_id = ${entryAccountId}
        LIMIT 1
      `
      config = rows[0]
    }

    // Fallback: use first available config (handles Meta test payloads with id="0")
    if (!config) {
      const rows = await prisma.$queryRaw<RawConfig[]>`
        SELECT account_id, access_token, verify_token, instagram_account_id, page_id
        FROM instagram_config
        LIMIT 1
      `
      config = rows[0]
    }

    if (!config) {
      console.warn(`[Instagram] No config found for entry ID: ${entryAccountId}`)
      continue
    }

    const instagramAccountId = config.instagram_account_id ?? entryAccountId

    // ── Changes format (what Meta actually sends) ────────────────
    for (const change of entry.changes ?? []) {
      const val = change.value
      const senderIgsid = val?.sender?.id
      if (!senderIgsid || senderIgsid === instagramAccountId) continue
      const ts = typeof val.timestamp === "string" ? parseInt(val.timestamp) : (val.timestamp ?? Date.now() / 1000)

      // Regular message (text, media, quick reply tap)
      if (change.field === "messages") {
        const msg = val.message
        if (!msg || msg.is_echo) continue

        await processIgMessage({
          accountId:         config.account_id,
          accessToken:       config.access_token ?? "",
          senderIgsid,
          messageId:         msg.mid ?? `ig_${Date.now()}`,
          text:              msg.text ?? null,
          attachments:       msg.attachments ?? [],
          timestamp:         ts,
          quickReplyPayload: msg.quick_reply?.payload ?? null,
          postbackPayload:   null,
        })
      }

      // Button Template tap fires messaging_postbacks (not messages)
      if (change.field === "messaging_postbacks") {
        const postback = val.postback
        if (!postback?.payload) continue

        console.log('[Instagram] postback received from', senderIgsid, '| payload:', postback.payload, '| title:', postback.title)

        await processIgMessage({
          accountId:         config.account_id,
          accessToken:       config.access_token ?? "",
          senderIgsid,
          messageId:         postback.mid ?? `ig_pb_${Date.now()}`,
          text:              postback.title ?? null,
          attachments:       [],
          timestamp:         ts,
          quickReplyPayload: null,
          postbackPayload:   postback.payload,
        })
      }
    }

    // ── Messaging format (legacy fallback) ───────────────────────
    for (const event of entry.messaging ?? []) {
      const senderIgsid = event.sender.id
      if (senderIgsid === instagramAccountId) continue
      const ts = typeof event.timestamp === "string" ? parseInt(event.timestamp) : event.timestamp

      if (event.message) {
        const msg = event.message
        if (msg.is_echo) continue
        await processIgMessage({
          accountId:         config.account_id,
          accessToken:       config.access_token ?? "",
          senderIgsid,
          messageId:         msg.mid,
          text:              msg.text ?? null,
          attachments:       msg.attachments ?? [],
          timestamp:         ts,
          quickReplyPayload: msg.quick_reply?.payload ?? null,
          postbackPayload:   null,
        })
      }

      if (event.postback) {
        const postback = event.postback
        if (!postback?.payload) continue
        await processIgMessage({
          accountId:         config.account_id,
          accessToken:       config.access_token ?? "",
          senderIgsid,
          messageId:         postback.mid ?? `ig_pb_${Date.now()}`,
          text:              postback.title ?? null,
          attachments:       [],
          timestamp:         ts,
          quickReplyPayload: null,
          postbackPayload:   postback.payload,
        })
      }
    }
  }
}

async function processIgMessage({
  accountId,
  accessToken,
  senderIgsid,
  messageId,
  text,
  attachments,
  timestamp,
  quickReplyPayload,
  postbackPayload,
}: {
  accountId:         string
  accessToken:       string
  senderIgsid:       string
  messageId:         string
  text:              string | null
  attachments:       Array<{ type: string; payload: { url?: string } }>
  timestamp:         number
  quickReplyPayload: string | null
  postbackPayload:   string | null
}) {
  // --- Find or create owner (admin) user for this account ---
  const ownerProfile = await prisma.profile.findFirst({
    where: { account_id: accountId },
    orderBy: { created_at: "asc" },
    select: { user_id: true },
  })
  if (!ownerProfile) return
  const ownerUserId = ownerProfile.user_id

  // --- Find or create contact ---
  const contact = await findOrCreateIgContact(accountId, ownerUserId, senderIgsid, accessToken)
  if (!contact) return

  // --- Find or create conversation (channel = instagram) ---
  const conversation = await findOrCreateIgConversation(accountId, ownerUserId, contact.id)
  if (!conversation) return

  // --- Parse content ---
  let contentText: string | null = text
  let mediaUrl:    string | null = null
  let contentType: string = "text"

  if (attachments.length > 0) {
    const att = attachments[0]
    if (att.type === "image")  { contentType = "image";    mediaUrl = att.payload.url ?? null }
    if (att.type === "video")  { contentType = "video";    mediaUrl = att.payload.url ?? null }
    if (att.type === "audio")  { contentType = "audio";    mediaUrl = att.payload.url ?? null }
    if (att.type === "file")   { contentType = "document"; mediaUrl = att.payload.url ?? null }
    if (!contentText && mediaUrl) contentText = `[${att.type}]`
  }

  if (!contentText && !mediaUrl) contentText = "[message]"

  // --- Save message ---
  try {
    const savedMsg = await prisma.message.create({
      data: {
        conversation_id: conversation.id,
        sender_type:     "customer",
        content_type:    contentType,
        content_text:    contentText,
        media_url:       mediaUrl,
        message_id:      messageId,
        status:          "delivered",
        created_at:      new Date(timestamp),
      },
    })
    emitToAccount(accountId, "message", { eventType: "INSERT", new: savedMsg, old: {} })
  } catch (err: unknown) {
    // Duplicate mid — Instagram sometimes re-delivers
    const e = err as { code?: string }
    if (e.code === "P2002") return
    console.error("[Instagram] message insert failed:", err)
    return
  }

  // --- Update conversation ---
  try {
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        last_message_text: contentText ?? `[${contentType}]`,
        last_message_at:   new Date(),
        unread_count:      { increment: 1 },
      },
    })
    emitToAccount(accountId, "conversation", { eventType: "UPDATE", new: updatedConv, old: {} })
  } catch (err) {
    console.error("[Instagram] conversation update failed:", err)
  }

  // --- Mark message as seen (per Meta best practices) ---
  if (accessToken) {
    fetch(
      `https://graph.instagram.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: senderIgsid }, sender_action: 'mark_seen' }),
      }
    ).catch(() => {})
  }

  // --- Dispatch to chatbot flow engine (Instagram channel only) ---
  // Button Template tap → messaging_postbacks → postbackPayload = button id (reply_id)
  // Quick Reply tap   → messages.quick_reply  → quickReplyPayload = button payload
  // Both map to interactive_reply so the engine's button-matching logic works identically
  const replyId = postbackPayload ?? quickReplyPayload
  const engineMessage = replyId
    ? { kind: "interactive_reply" as const, reply_id: replyId, reply_title: contentText ?? "", meta_message_id: messageId }
    : { kind: "text" as const, text: contentText ?? "", meta_message_id: messageId }

  // Count messages in this conversation to detect the first inbound
  const msgCount = await prisma.message.count({
    where: { conversation_id: conversation.id, sender_type: 'customer' },
  }).catch(() => 1)

  dispatchInboundToFlows({
    accountId,
    userId:         ownerUserId,
    contactId:      contact.id,
    conversationId: conversation.id,
    channel:        "instagram",
    message:        engineMessage,
    isFirstInboundMessage: msgCount <= 1,
  }).catch((err) => console.error("[Instagram] dispatchInboundToFlows error:", err))
}

async function findOrCreateIgContact(
  accountId: string,
  ownerUserId: string,
  igsid: string,
  accessToken: string,
) {
  // Instagram IGSID stored as phone (numeric string, won't collide with real E.164 numbers)
  const existing = await findExistingContact(accountId, igsid)
  if (existing) return existing

  // Try to fetch the user's display name from Instagram Graph API
  let displayName = igsid
  if (accessToken) {
    try {
      const res = await fetch(
        `https://graph.instagram.com/v21.0/${igsid}?fields=name,username&access_token=${accessToken}`,
        { cache: "no-store" }
      )
      if (res.ok) {
        const data = await res.json() as { name?: string; username?: string }
        displayName = data.name ?? data.username ?? igsid
      }
    } catch { /* name is non-critical */ }
  }

  try {
    const contact = await prisma.contact.create({
      data: {
        account_id:       accountId,
        user_id:          ownerUserId,
        phone:            igsid,
        phone_normalized: igsid.replace(/\D/g, ""),
        name:             displayName,
      },
    })
    return contact
  } catch (err) {
    if (isUniqueViolation(err)) {
      return findExistingContact(accountId, igsid)
    }
    console.error("[Instagram] contact create failed:", err)
    return null
  }
}

async function findOrCreateIgConversation(
  accountId: string,
  ownerUserId: string,
  contactId: string,
) {
  // Look for an existing Instagram conversation for this contact
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId },
  })
  if (existing) {
    // Always ensure channel is set — it may be NULL on conversations created before this column existed
    await prisma.$executeRaw`
      UPDATE conversations SET channel = 'instagram'
      WHERE id = ${existing.id}::uuid AND (channel IS NULL OR channel != 'instagram')
    `.catch(() => {})
    return existing
  }

  try {
    return await prisma.conversation.create({
      data: {
        account_id: accountId,
        user_id:    ownerUserId,
        contact_id: contactId,
        channel:    "instagram",
      },
    })
  } catch (err) {
    console.error("[Instagram] conversation create failed:", err)
    return null
  }
}
