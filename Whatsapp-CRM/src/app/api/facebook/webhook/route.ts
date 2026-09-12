import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { dispatchInboundToFlows } from "@/lib/flows/engine"
import { normalizePhone } from "@/lib/whatsapp/phone-utils"
import { fetchLead, getLeadField, fetchAdTargeting } from "@/lib/meta-ads/api"
import { runAutomationsForTrigger } from "@/lib/automations/engine"
import { isUniqueViolation } from "@/lib/contacts/dedupe"

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
    // Present when field === "leadgen" — a new Lead Ads / Instant Form
    // submission. Meta's own documented shape: the webhook only carries
    // the ID, a follow-up Graph API call (fetchLead) gets the answers.
    leadgen_id?: string
    form_id?: string
    ad_id?: string
    adgroup_id?: string
    created_time?: number
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

      // Lead Ads / Instant Form submissions — same Page-object webhook,
      // a different field. Each notification only carries an ID; the
      // real answers are fetched with a follow-up Graph API call.
      const leadgenChanges = entry.changes.filter((c) => c.field === "leadgen" && c.value.leadgen_id)
      for (const change of leadgenChanges) {
        processLeadgenChange(config.account_id, config.access_token ?? "", pageId, change.value).catch((err) =>
          console.error("[Facebook] processLeadgenChange error:", err)
        )
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

/**
 * One Lead Ads / Instant Form submission — Meta's documented two-step
 * flow: the webhook only carries `leadgen_id`, so the real answers are
 * fetched with a follow-up Graph API call, then mapped into this app's
 * own Contact/Lead model exactly the way /api/external/webhook does for
 * any other external lead source.
 */
async function processLeadgenChange(
  accountId: string,
  accessToken: string,
  pageId: string,
  value: { leadgen_id?: string; form_id?: string; ad_id?: string },
) {
  const leadgenId = value.leadgen_id
  if (!leadgenId || !accessToken) return

  // Idempotent — Meta's webhooks can and do redeliver the same notification.
  const already = await prisma.leadAdSubmission.findUnique({ where: { meta_leadgen_id: leadgenId } })
  if (already) return

  const ownerProfile = await prisma.profile.findFirst({
    where: { account_id: accountId },
    orderBy: { created_at: "asc" },
    select: { user_id: true },
  })
  if (!ownerProfile) return
  const ownerUserId = ownerProfile.user_id

  // fetchLead (the lead's answers) and fetchAdTargeting (the ad set's
  // placement, for platform resolution below) are independent Graph API
  // calls — neither's input depends on the other's output — so they run
  // concurrently instead of paying the sum of both round trips on every
  // lead, which matters when Lead Ads webhooks arrive in a campaign-spike
  // burst.
  const [lead, targetingResult] = await Promise.all([
    fetchLead({ leadId: leadgenId, accessToken }),
    value.ad_id
      ? fetchAdTargeting({ adId: value.ad_id, accessToken }).catch((err) => {
          console.error("[Facebook] fetchAdTargeting failed (non-fatal):", err)
          return null
        })
      : Promise.resolve(null),
  ])

  // The webhook notification itself sometimes omits form_id — fall back to
  // whatever the follow-up lead-detail fetch returned before giving up on
  // resolving a form at all (see LeadAdSubmission.form_id's own comment
  // for why a submission row is still created either way).
  const resolvedFormId = value.form_id ?? lead.form_id
  const form = resolvedFormId
    ? await prisma.leadAdForm.upsert({
        where: { meta_form_id: resolvedFormId },
        create: { account_id: accountId, meta_form_id: resolvedFormId, page_id: pageId, name: `Form ${resolvedFormId}` },
        update: {},
      })
    : null

  // A form the account has explicitly paused in the Lead Ads form
  // manager — the submission still happened on Meta's side, but this
  // account chose not to sync it into the CRM.
  if (form && !form.is_active) return

  // Resolve Facebook vs Instagram vs "mixed" — the lead object itself
  // carries NO platform field (confirmed against Meta's Retrieving Leads
  // docs), so this is the only way to know: the ad set's own
  // targeting.publisher_platforms. A single-platform ad set resolves
  // cleanly; an Advantage+/automatic-placement ad set (0 or >1 platforms)
  // genuinely cannot be attributed per-lead by Meta — stored as 'mixed'
  // rather than guessed down to a single platform. Best-effort: a failed
  // lookup (revoked token, deleted ad) leaves platform unresolved (null),
  // never treated as fatal for the rest of this lead's processing.
  let platform: "facebook" | "instagram" | "mixed" | null = null
  if (targetingResult) {
    const platforms = targetingResult.publisher_platforms ?? []
    platform = platforms.length === 1
      ? (platforms[0] as "facebook" | "instagram")
      : "mixed"
  }
  const isInstagram = platform === "instagram"
  const sourceTag = isInstagram ? "instagram_lead_ad" : "facebook_lead_ad"
  const tagName = isInstagram ? "Instagram Lead Ad" : "Facebook Lead Ad"
  const tagColor = isInstagram ? "#D946A6" : "#0866FF"
  const externalIdPrefix = isInstagram ? "ig_lead_ad" : "fb_lead_ad"
  const leadTitle = isInstagram ? "Instagram Lead Ad" : "Facebook Lead Ad"

  const fullName = getLeadField(lead, "full_name") ?? getLeadField(lead, "name")
  const email = getLeadField(lead, "email")
  const phoneRaw = getLeadField(lead, "phone_number") ?? getLeadField(lead, "phone")

  // Contact.phone is NOT NULL — same "email:..."-style placeholder
  // convention Broadcasts already uses for contacts with no real number.
  const phoneValue = phoneRaw || (email ? `email:${email}` : `leadgen:${leadgenId}`)
  const normalized = phoneRaw ? normalizePhone(phoneRaw) : null

  const existingContact = normalized
    ? await prisma.contact.findFirst({ where: { account_id: accountId, phone_normalized: normalized } })
    : null

  const contact = existingContact ?? await prisma.contact.create({
    data: {
      account_id: accountId,
      user_id: ownerUserId,
      name: fullName || phoneRaw || "Facebook Lead",
      phone: phoneValue,
      phone_normalized: normalized,
      email: email ?? null,
      // Submitting a Lead Ads form is an explicit consent action.
      opt_in_status: "opted_in",
      opt_in_source: sourceTag,
      opt_in_at: new Date(),
    },
  })

  // Tag every ad-sourced contact (new or existing) — this is what makes
  // "specifically ad leads" an actionable condition in the Automation
  // builder's existing Tag Presence check, without inventing a whole new
  // trigger-config filter just for this one source. Instagram- and
  // Facebook-sourced leads get distinct tags once platform is resolved;
  // an unresolved/mixed-placement lead keeps the generic Facebook tag
  // rather than a separate "maybe Instagram" tag that would just add noise.
  const adTag = await prisma.tag.findFirst({ where: { account_id: accountId, name: tagName } })
    ?? await prisma.tag.create({ data: { account_id: accountId, user_id: ownerUserId, name: tagName, color: tagColor } })
  await prisma.contactTag.upsert({
    where: { contact_id_tag_id: { contact_id: contact.id, tag_id: adTag.id } },
    create: { contact_id: contact.id, tag_id: adTag.id },
    update: {},
  })

  // Real automation trigger — a brand-new contact from an ad ads now
  // participates in "New Contact Created" automations exactly like a
  // contact from any other channel does (it didn't before this feature).
  if (!existingContact) {
    runAutomationsForTrigger({
      accountId,
      triggerType: "new_contact_created",
      contactId: contact.id,
      context: { vars: { source: sourceTag } },
    }).catch((err) => console.error("[Facebook] Lead Ad automation dispatch failed (non-fatal):", err))
  }

  const createdLead = await prisma.lead.create({
    data: {
      account_id: accountId,
      user_id: ownerUserId,
      title: form?.name ?? leadTitle,
      source: sourceTag,
      status: "new",
      contact_id: contact.id,
      external_id: `${externalIdPrefix}:${leadgenId}`,
    },
  })

  await prisma.leadActivity.create({
    data: {
      account_id: accountId,
      lead_id: createdLead.id,
      contact_id: contact.id,
      user_id: ownerUserId,
      type: "created",
      title: `Lead captured from ${leadTitle}`,
      description: form?.name ? `Form: ${form.name}` : null,
    },
  })

  // Always created, even when no form could be resolved (form_id: null) —
  // this row is what makes the meta_leadgen_id idempotency check at the
  // top of this function actually work for every lead, not just ones
  // Meta happened to attach a form_id to.
  await prisma.leadAdSubmission.create({
    data: {
      account_id: accountId,
      form_id: form?.id ?? null,
      meta_leadgen_id: leadgenId,
      ad_id: value.ad_id ?? null,
      lead_id: createdLead.id,
      platform,
      // field_data is a plain array of {name, values} objects — fully
      // JSON-serializable, just needs the structural cast Prisma's Json
      // input type requires since it can't infer that from our own
      // LeadFieldData[] type.
      raw_field_data: lead.field_data as unknown as Prisma.InputJsonValue,
    },
  })

  emitToAccount(accountId, "lead", { eventType: "INSERT", new: createdLead })
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
    // Matched by exact equality on the dedicated facebook_id column — not
    // findExistingContact's fuzzy last-8-digit phone matching (meant for
    // trunk-prefix tolerance on real phone numbers, a cross-channel collision
    // risk when reused for a platform ID) and not phone_normalized either
    // (see supabase/migrations/025_contact_platform_ids.sql).
    return await prisma.contact.upsert({
      where: {
        contacts_account_facebook_id: {
          account_id:  accountId,
          facebook_id: psid,
        },
      },
      create: {
        account_id:       accountId,
        user_id:          ownerUserId,
        // phone still carries the PSID too (unchanged) — several existing
        // send paths (e.g. handleFacebookSend) read contact.phone as the
        // recipient id for this channel. facebook_id is the new column used
        // exclusively for collision-safe lookup.
        phone:            psid,
        phone_normalized: psid.replace(/\D/g, ""),
        facebook_id:      psid,
        name:             nameToSave,
        opt_in_status:    "opted_in",
        opt_in_source:    "facebook_inbound",
        opt_in_at:        new Date(),
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
    // Lost a race: a concurrent inbound delivery created this conversation
    // between our findFirst and our insert. No DB-level unique constraint
    // backs this for Facebook/Instagram (whatsapp_config_id is always null
    // here, and a plain UNIQUE constraint doesn't treat two NULLs as a
    // collision) — but re-checking on any unexpected error still recovers
    // cleanly if one ever does land here. Same pattern as WhatsApp's
    // findOrCreateConversation (src/app/api/whatsapp/webhook/route.ts).
    if (isUniqueViolation(err)) {
      const raced = await prisma.conversation.findFirst({
        where: { account_id: accountId, contact_id: contactId, channel: "facebook" },
      })
      if (raced) return raced
    }
    console.error("[Facebook] conversation create failed:", err)
    return null
  }
}
