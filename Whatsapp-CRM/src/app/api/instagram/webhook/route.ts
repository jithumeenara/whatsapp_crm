import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { isUniqueViolation } from "@/lib/contacts/dedupe"
import { dispatchInboundToFlows } from "@/lib/flows/engine"
import { runAutomationsForTrigger } from "@/lib/automations/engine"

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
        ice_breakers         JSONB,
        persistent_menu      JSONB,
        profile_synced_at    TIMESTAMPTZ,
        comment_dm_status    TEXT        NOT NULL DEFAULT 'pending_meta_approval',
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
    // Present when the customer replied to one of the business's own
    // Stories — a normal `messages` event, not a separate subscription.
    reply_to?: { story?: { url?: string; id?: string }; mid?: string }
  }
  // Button Template tap fires messaging_postbacks (not messages)
  postback?: {
    title: string
    payload: string
    mid?: string
  }
  read?:     { watermark: number }
  delivery?: { watermark: number }
  // Present ONLY on the customer's first message when the conversation
  // started from a Click-to-Instagram ad — mirrors WhatsApp's referral
  // object (src/app/api/whatsapp/webhook/route.ts). Instagram's documented
  // shape carries `ref`/`source_id` rather than a dedicated `ctwa_clid`
  // field; whichever identifier Meta actually sends is stored into the
  // same Conversation.ctwa_clid column WhatsApp uses, since it serves the
  // identical purpose (the per-click attribution token).
  referral?: {
    ref?: string
    source_id?: string
    source_type?: string
    source_url?: string
    headline?: string
  }
}

// IG·01 gated scaffolding — Meta's documented comments webhook shape.
// Requires the instagram_business_manage_comments permission (App
// Review) to ever actually be delivered — see comment_dm_status.
interface IgCommentValue {
  id: string
  text?: string
  from?: { id: string; username?: string }
  media?: { id: string; media_product_type?: string }
  parent_id?: string
}

// IG·02 gated scaffolding — Meta's story-mentions webhook is deliberately
// minimal: just a media ID, a follow-up Graph API call fetches the actual
// mention content. Same permission gate as comments.
interface IgMentionValue {
  media_id: string
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
      // Comments (IG·01, gated scaffolding) and story mentions (IG·02,
      // gated scaffolding) use a completely different value shape than
      // messaging events (no sender/recipient/timestamp) — handled first,
      // before the messaging-only sender extraction below would otherwise
      // silently skip them.
      if (change.field === "comments") {
        await processIgComment(config.account_id, config.access_token ?? "", change.value as unknown as IgCommentValue)
        continue
      }
      if (change.field === "mentions") {
        await processIgStoryMention(config.account_id, config.access_token ?? "", change.value as unknown as IgMentionValue)
        continue
      }

      const val = change.value
      const senderIgsid = val?.sender?.id
      if (!senderIgsid || senderIgsid === instagramAccountId) continue
      const ts = typeof val.timestamp === "string" ? parseInt(val.timestamp) : (val.timestamp ?? Date.now() / 1000)

      // Regular message (text, media, quick reply tap, story reply)
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
          storyReply:        msg.reply_to?.story ?? null,
          referral:          val.referral ?? null,
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
          storyReply:        null,
          referral:          val.referral ?? null,
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
          storyReply:        msg.reply_to?.story ?? null,
          referral:          event.referral ?? null,
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
          storyReply:        null,
          referral:          event.referral ?? null,
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
  storyReply,
  referral,
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
  storyReply:        { url?: string; id?: string } | null
  referral:          { ref?: string; source_id?: string; source_type?: string; source_url?: string; headline?: string } | null
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
  const contactOutcome = await findOrCreateIgContact(accountId, ownerUserId, senderIgsid, accessToken)
  if (!contactOutcome) return
  const { contact, wasCreated } = contactOutcome

  // --- Find or create conversation (channel = instagram) ---
  const conversation = await findOrCreateIgConversation(accountId, ownerUserId, contact.id)
  if (!conversation) return

  // --- Parse content ---
  let contentText: string | null = text
  let mediaUrl:    string | null = null
  let contentType: string = "text"
  let storyMediaUrl: string | null = null
  let storyMediaId:  string | null = null

  if (attachments.length > 0) {
    const att = attachments[0]
    if (att.type === "image")  { contentType = "image";    mediaUrl = att.payload.url ?? null }
    if (att.type === "video")  { contentType = "video";    mediaUrl = att.payload.url ?? null }
    if (att.type === "audio")  { contentType = "audio";    mediaUrl = att.payload.url ?? null }
    if (att.type === "file")   { contentType = "document"; mediaUrl = att.payload.url ?? null }
    if (!contentText && mediaUrl) contentText = `[${att.type}]`
  }

  // Story reply — takes priority over a plain-text classification since
  // Meta sends both `text` and `reply_to.story` on the same event.
  if (storyReply) {
    contentType = "story_reply"
    storyMediaUrl = storyReply.url ?? null
    storyMediaId = storyReply.id ?? null
    if (!contentText) contentText = "[replied to your story]"
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
        story_media_url: storyMediaUrl,
        story_media_id:  storyMediaId,
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
  const isFirstInboundMessage = msgCount <= 1

  // Click-to-Instagram ad attribution — mirrors WhatsApp's ctwa_clid capture
  // (src/app/api/whatsapp/webhook/route.ts). Instagram's referral object
  // doesn't document a dedicated ctwa_clid field the way WhatsApp's does —
  // whichever click-identifier Meta actually sent (`ref` or `source_id`) is
  // stored into the same Conversation.ctwa_clid column, since it serves the
  // identical purpose. Also grants the 72h Free Entry Point window from
  // this first reply — see fep_expires_at on Conversation.
  if (isFirstInboundMessage && referral && !conversation.ctwa_clid) {
    try {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          ctwa_clid: referral.ref ?? referral.source_id ?? null,
          ctwa_ad_headline: referral.headline ?? null,
          ctwa_source_id: referral.source_id ?? null,
          fep_expires_at: new Date(Date.now() + 72 * 3600 * 1000),
        },
      })
    } catch (err) {
      console.error('[Instagram] failed to store ctwa attribution (non-fatal):', err)
    }
  }

  // Awaited (not fire-and-forget) so we know whether the Flow engine
  // consumed this message before also deciding which Automations to fire —
  // mirrors the WhatsApp webhook's flowResult.consumed gate exactly
  // (src/app/api/whatsapp/webhook/route.ts) so a flow reply and an
  // automation reply never both fire for the same inbound message.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId:         ownerUserId,
    contactId:      contact.id,
    conversationId: conversation.id,
    channel:        "instagram",
    message:        engineMessage,
    isFirstInboundMessage,
  }).catch((err) => {
    console.error("[Instagram] dispatchInboundToFlows error:", err)
    return { consumed: false as const, outcome: "no_match" as const }
  })

  // --- Dispatch to the Automations engine too ---
  // Previously Instagram never fired this at all (only WhatsApp/Facebook
  // did) — keyword_match/new_contact_created/tag_added/etc. Automations
  // silently never triggered for Instagram conversations. Wired here the
  // same way the WhatsApp webhook does it.
  const igAutomationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowResult.consumed) {
    igAutomationTriggers.push('new_message_received', 'keyword_match')
  }
  if (wasCreated) igAutomationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) igAutomationTriggers.unshift('first_inbound_message')
  for (const triggerType of igAutomationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contact.id,
      context: {
        message_text: contentText ?? '',
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations] IG dispatch failed:', err))
  }
}

/**
 * IG·01 — Comment-to-DM, GATED scaffolding. This function is fully wired
 * (contact resolution → keyword-match dispatch → DM reply via the normal
 * Automations action chain) but will never actually run in production
 * until Meta approves instagram_business_manage_comments for this app —
 * Meta will not deliver the `comments` webhook field before that. Testable
 * today only by hand-crafting a matching payload directly against this
 * route (bypassing Meta's real delivery gate) to prove the logic itself
 * is correct.
 */
async function processIgComment(accountId: string, accessToken: string, comment: IgCommentValue) {
  if (!comment?.id || !comment.from?.id) return

  const ownerProfile = await prisma.profile.findFirst({
    where: { account_id: accountId },
    orderBy: { created_at: "asc" },
    select: { user_id: true },
  })
  if (!ownerProfile) return

  // Comments and DMs share the same IGSID namespace per Meta's docs — the
  // commenter can be found/created exactly like a DM sender.
  const contactOutcome = await findOrCreateIgContact(accountId, ownerProfile.user_id, comment.from.id, accessToken)
  if (!contactOutcome) return

  runAutomationsForTrigger({
    accountId,
    triggerType: "comment_keyword_match",
    contactId: contactOutcome.contact.id,
    context: {
      message_text: comment.text ?? "",
      vars: { comment_id: comment.id, media_id: comment.media?.id ?? null },
    },
  }).catch((err) => console.error("[Instagram] comment_keyword_match dispatch failed:", err))
}

/**
 * IG·02 — Story mentions, GATED scaffolding. Same Meta App Review gate as
 * comments above (instagram_manage_mentions). Meta's mentions webhook is
 * deliberately minimal (just a media ID) — the actual mention content
 * would need a follow-up Graph API call (GET /{media-id}) once approved;
 * not implemented here since it cannot be tested against real data before
 * that approval exists, and Meta's exact response shape for that call
 * should be re-verified live at implementation time rather than assumed.
 */
async function processIgStoryMention(accountId: string, _accessToken: string, mention: IgMentionValue) {
  if (!mention?.media_id) return
  console.log(`[Instagram] story mention received (media_id=${mention.media_id}) — scaffolding only, not yet processed into a Message/Contact (requires Meta App Review approval + a follow-up media-fetch call not yet built).`)
}

async function findOrCreateIgContact(
  accountId: string,
  ownerUserId: string,
  igsid: string,
  accessToken: string,
) {
  // Matched by exact equality on the dedicated instagram_id column — NOT
  // findExistingContact's fuzzy last-8-digit phone matching, which is meant
  // for trunk-prefix tolerance on real phone numbers and risks cross-channel
  // collisions against unrelated WhatsApp contacts when reused for a platform
  // ID (see supabase/migrations/025_contact_platform_ids.sql).
  const existing = await prisma.contact.findFirst({
    where: { account_id: accountId, instagram_id: igsid },
  })
  if (existing) return { contact: existing, wasCreated: false }

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
        // phone still carries the IGSID too (unchanged) — several existing
        // send paths (e.g. handleInstagramSend, engineSendTextInstagram) read
        // contact.phone as the recipient id for this channel. instagram_id is
        // the new column used exclusively for collision-safe lookup above.
        phone:            igsid,
        phone_normalized: igsid.replace(/\D/g, ""),
        instagram_id:     igsid,
        name:             displayName,
        opt_in_status:    "opted_in",
        opt_in_source:    "instagram_inbound",
        opt_in_at:        new Date(),
      },
    })
    return { contact, wasCreated: true }
  } catch (err) {
    if (isUniqueViolation(err)) {
      const recovered = await prisma.contact.findFirst({ where: { account_id: accountId, instagram_id: igsid } })
      return recovered ? { contact: recovered, wasCreated: false } : null
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
  // Scoped by channel — previously this looked up ANY conversation for the
  // contact_id (no channel filter) and then force-overwrote channel to
  // 'instagram' on whatever it found, which could silently relabel a
  // WhatsApp conversation (and all its prior messages) as Instagram if the
  // same contact_id was ever shared across channels. Matches Facebook's
  // findOrCreateFbConversation.
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId, channel: 'instagram' },
  })
  if (existing) {
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
    // Lost a race: a concurrent inbound delivery created this conversation
    // between our findFirst and our insert. No DB-level unique constraint
    // backs this for Instagram/Facebook (whatsapp_config_id is always null
    // here, and a plain UNIQUE constraint doesn't treat two NULLs as a
    // collision) — but re-checking on any unexpected error still recovers
    // cleanly if one ever does land here. Same pattern as WhatsApp's
    // findOrCreateConversation (src/app/api/whatsapp/webhook/route.ts).
    if (isUniqueViolation(err)) {
      const raced = await prisma.conversation.findFirst({
        where: { account_id: accountId, contact_id: contactId, channel: "instagram" },
      })
      if (raced) return raced
    }
    console.error("[Instagram] conversation create failed:", err)
    return null
  }
}
