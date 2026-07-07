import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe"
import { dispatchInboundToFlows } from "@/lib/flows/engine"

type RawConfig = {
  account_id: string
  access_token: string | null
  verify_token: string | null
  page_id: string | null
}

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS facebook_config (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id   UUID        UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      access_token TEXT,
      verify_token TEXT,
      page_id      TEXT,
      app_secret   TEXT,
      status       TEXT        NOT NULL DEFAULT 'disconnected',
      page_name    TEXT,
      last_tested_at TIMESTAMPTZ,
      test_error   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.catch(() => {})
  tableReady = true
}

// Warm up table + DB connection at module load so the GET verify handler is instant
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

  // Also check FACEBOOK_VERIFY_TOKEN env var as a fast path (no DB needed)
  if (process.env.FACEBOOK_VERIFY_TOKEN && token === process.env.FACEBOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }

  await ensureTable()

  try {
    const rows = await prisma.$queryRaw<RawConfig[]>`
      SELECT account_id, access_token, verify_token, page_id
      FROM facebook_config
      WHERE verify_token = ${token}
      LIMIT 1
    `
    if (rows[0]) {
      return new NextResponse(challenge, { status: 200 })
    }
  } catch (err) {
    console.error("[Facebook Webhook] DB error during verify:", err)
  }

  console.error(`[Facebook Webhook] Verify token not found: "${token}"`)
  return new NextResponse("Forbidden", { status: 403 })
}

// ── POST — receive messages from Facebook Messenger ───────────────────────────
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    if (!raw.trim()) return NextResponse.json({ status: "ok" })
    const body = JSON.parse(raw) as FbWebhookBody

    if (body.object !== "page") {
      return NextResponse.json({ status: "ignored" })
    }

    processFacebookWebhook(body).catch((err) =>
      console.error("[Facebook Webhook] processFacebookWebhook error:", err)
    )

    return NextResponse.json({ status: "ok" })
  } catch (err) {
    console.error("[Facebook Webhook Error]", err)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}

interface FbMessage {
  mid: string
  text?: string
  attachments?: Array<{ type: string; payload: { url?: string } }>
  is_echo?: boolean
  quick_reply?: { payload: string }
}

interface FbPostback {
  title: string
  payload: string
  mid?: string
}

interface FbMessagingEvent {
  sender:    { id: string }
  recipient: { id: string }
  timestamp: number
  message?:  FbMessage
  postback?:  FbPostback
  read?:     { watermark: number }
  delivery?: { watermark: number }
}

interface FbFeedChange {
  field: string
  value: {
    item?: string   // "comment" | "post" | "like" | "reaction" | "share"
    verb?: string   // "add" | "remove" | "edit"
    post_id?: string
    comment_id?: string
    sender_id?: string
    message?: string
  }
}

interface FbWebhookBody {
  object: string
  entry: Array<{
    id: string
    time?: number
    messaging?: FbMessagingEvent[]
    changes?: FbFeedChange[]
  }>
}

async function processFacebookWebhook(body: FbWebhookBody) {
  await ensureTable()

  for (const entry of body.entry ?? []) {
    const pageId = entry.id

    let config: RawConfig | undefined
    if (pageId) {
      const rows = await prisma.$queryRaw<RawConfig[]>`
        SELECT account_id, access_token, verify_token, page_id
        FROM facebook_config WHERE page_id = ${pageId} LIMIT 1
      `
      config = rows[0]
    }
    if (!config) {
      const rows = await prisma.$queryRaw<RawConfig[]>`
        SELECT account_id, access_token, verify_token, page_id
        FROM facebook_config LIMIT 1
      `
      config = rows[0]
    }
    if (!config) {
      console.warn(`[Facebook] No config found for page ID: ${pageId}`)
      continue
    }

    // Handle feed changes (post likes, comments, reactions)
    if (entry.changes?.length) {
      const feedChanges = entry.changes.filter((c) => c.field === "feed")
      if (feedChanges.length > 0 && config) {
        emitToAccount(config.account_id, "facebook_feed_update", {
          pageId,
          changes: feedChanges.map((c) => ({ item: c.value.item, verb: c.value.verb })),
        })
      }
    }

    for (const event of entry.messaging ?? []) {
      const senderPsid = event.sender.id
      // Skip echoes (messages sent by the page itself)
      if (senderPsid === (config.page_id ?? pageId)) continue
      if (event.message?.is_echo) continue
      // Skip read/delivery receipts
      if (event.read || event.delivery) continue

      if (event.message) {
        await processFbMessage({
          accountId:         config.account_id,
          accessToken:       config.access_token ?? "",
          senderPsid,
          messageId:         event.message.mid,
          text:              event.message.text ?? null,
          attachments:       event.message.attachments ?? [],
          timestamp:         event.timestamp,
          quickReplyPayload: event.message.quick_reply?.payload ?? null,
          postbackPayload:   null,
          postbackTitle:     null,
        })
      }

      if (event.postback) {
        await processFbMessage({
          accountId:         config.account_id,
          accessToken:       config.access_token ?? "",
          senderPsid,
          messageId:         event.postback.mid ?? `fb_pb_${Date.now()}`,
          text:              event.postback.title ?? null,
          attachments:       [],
          timestamp:         event.timestamp,
          quickReplyPayload: null,
          postbackPayload:   event.postback.payload,
          postbackTitle:     event.postback.title ?? null,
        })
      }
    }
  }
}

async function processFbMessage({
  accountId,
  accessToken,
  senderPsid,
  messageId,
  text,
  attachments,
  timestamp,
  quickReplyPayload,
  postbackPayload,
  postbackTitle,
}: {
  accountId:         string
  accessToken:       string
  senderPsid:       string
  messageId:         string
  text:              string | null
  attachments:       Array<{ type: string; payload: { url?: string } }>
  timestamp:         number
  quickReplyPayload: string | null
  postbackPayload:   string | null
  postbackTitle:     string | null
}) {
  const ownerProfile = await prisma.profile.findFirst({
    where: { account_id: accountId },
    orderBy: { created_at: "asc" },
    select: { user_id: true },
  })
  if (!ownerProfile) return
  const ownerUserId = ownerProfile.user_id

  const contact = await findOrCreateFbContact(accountId, ownerUserId, senderPsid, accessToken)
  if (!contact) return

  const conversation = await findOrCreateFbConversation(accountId, ownerUserId, contact.id)
  if (!conversation) return

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
    if ((err as { code?: string }).code === "P2002") return
    console.error("[Facebook] message insert failed:", err)
    return
  }

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
    console.error("[Facebook] conversation update failed:", err)
  }

  // Mark seen
  if (accessToken) {
    fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: senderPsid }, sender_action: "mark_seen" }),
    }).catch(() => {})
  }

  const replyId = postbackPayload ?? quickReplyPayload
  const engineMessage = replyId
    ? { kind: "interactive_reply" as const, reply_id: replyId, reply_title: postbackTitle ?? contentText ?? "", meta_message_id: messageId }
    : { kind: "text" as const, text: contentText ?? "", meta_message_id: messageId }

  const msgCount = await prisma.message.count({
    where: { conversation_id: conversation.id, sender_type: "customer" },
  }).catch(() => 1)

  dispatchInboundToFlows({
    accountId,
    userId:         ownerUserId,
    contactId:      contact.id,
    conversationId: conversation.id,
    channel:        "facebook",
    message:        engineMessage,
    isFirstInboundMessage: msgCount <= 1,
  }).catch((err) => console.error("[Facebook] dispatchInboundToFlows error:", err))
}

async function findOrCreateFbContact(
  accountId: string,
  ownerUserId: string,
  psid: string,
  accessToken: string,
) {
  const existing = await findExistingContact(accountId, psid)
  if (existing) return existing

  // Try to fetch the real name from Facebook Graph API.
  // Requires "Business Asset User Profile Access" feature on the Meta app.
  let displayName: string | null = null
  if (accessToken) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${psid}?fields=name,first_name,last_name&access_token=${accessToken}`,
        { cache: "no-store" }
      )
      if (res.ok) {
        const data = await res.json() as { name?: string; first_name?: string; last_name?: string }
        const full = data.name ?? [data.first_name, data.last_name].filter(Boolean).join(" ")
        if (full) displayName = full
      }
    } catch { /* non-critical */ }
  }

  // Fallback: "Messenger User" is more readable than a raw numeric PSID
  const nameToSave = displayName ?? "Messenger User"

  try {
    return await prisma.contact.upsert({
      where: {
        contacts_account_phone_normalized: {
          account_id:       accountId,
          phone_normalized: psid.replace(/\D/g, ""),
        },
      },
      create: {
        account_id:       accountId,
        user_id:          ownerUserId,
        phone:            psid,
        phone_normalized: psid.replace(/\D/g, ""),
        name:             nameToSave,
      },
      // Update name if we got a real name from the API (replaces old PSID or "Messenger User" default)
      update: displayName ? { name: displayName } : {},
    })
  } catch (err) {
    console.error("[Facebook] contact upsert failed:", err)
    return null
  }
}

async function findOrCreateFbConversation(
  accountId: string,
  ownerUserId: string,
  contactId: string,
) {
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId, channel: "facebook" },
  })
  if (existing) return existing

  try {
    return await prisma.conversation.create({
      data: { account_id: accountId, user_id: ownerUserId, contact_id: contactId, channel: "facebook" },
    })
  } catch (err) {
    console.error("[Facebook] conversation create failed:", err)
    return null
  }
}
