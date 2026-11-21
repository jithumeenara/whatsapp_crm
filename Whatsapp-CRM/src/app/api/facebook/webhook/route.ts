import { NextRequest, NextResponse } from "next/server"
import { sameToken, scopeAllows, socialWebhookScope, type SocialWebhookScope } from "@/lib/social/webhook-secrets"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { recordAdTouch, referralFromMeta } from "@/lib/ads/attribution"
import { emitToAccount } from "@/lib/socket"
import { dispatchInboundToFlows } from "@/lib/flows/engine"
import { normalizePhone } from "@/lib/whatsapp/phone-utils"
import { fetchLead, getLeadField, fetchAdTargeting } from "@/lib/meta-ads/api"
import { runAutomationsForTrigger } from "@/lib/automations/engine"
import { isUniqueViolation } from "@/lib/contacts/dedupe"
import { openStoredSecret } from "@/lib/whatsapp/encryption"
import { webhookRejected, webhookWrote } from "@/lib/audit/actors"
import { fillPostDetails, markCommentAtMeta, saveIncomingComment } from "@/lib/meta/social-comments"
import { applySocialEdit, applySocialReaction, attachmentsToRows, noteBusinessAiHandoff, replyTargetId, saveSocialEcho } from "@/lib/meta/social-inbound"
import { GRAPH_API_VERSION } from '@/lib/meta/versions'

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
  if (sameToken(token, process.env.FACEBOOK_VERIFY_TOKEN)) {
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

  console.error(`[Facebook Webhook] verify token did not match any saved one (length ${token.length})`)
  return new NextResponse("Forbidden", { status: 403 })
}

// ── POST — receive messages from Facebook Messenger ───────────────────────────
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    if (!raw.trim()) return NextResponse.json({ status: "ok" })
    // Only Meta may post here: a forged event would land in an Inbox.
    // A tenant's own app secret only vouches for that tenant's events —
    // see socialWebhookScope.
    const scope = await socialWebhookScope(raw, req.headers.get("x-hub-signature-256"), "facebook")
    if (!scope) {
      webhookRejected("facebook", null, "bad_signature")
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }
    const body = JSON.parse(raw) as FbWebhookBody

    if (body.object !== "page") {
      return NextResponse.json({ status: "ignored" })
    }

    processFacebookWebhook(body, scope).catch((err) =>
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
  /** The message the customer replied to. */
  reply_to?: { mid?: string }
  /** Meta Business AI hand-over notice (not a customer message). */
  admin_text?: string
  handoff_reason?: string
  quick_reply?: { payload: string }
  /** A Click-to-Messenger ad: ad_id, ads_context_data (src/lib/ads/attribution.ts). */
  referral?: unknown
}

interface FbPostback {
  title: string
  payload: string
  mid?: string
  /** A new thread opened from an ad arrives as a postback with its referral. */
  referral?: unknown
}

interface FbMessagingEvent {
  sender:    { id: string }
  recipient: { id: string }
  timestamp: number
  message?:  FbMessage
  postback?:  FbPostback
  read?:     { watermark: number }
  delivery?: { watermark: number }
  /** message_reactions */
  reaction?: { mid?: string; action?: string; emoji?: string; reaction?: string }
  /** message_edits */
  message_edit?: { mid?: string; text?: string; num_edit?: number }
  /** messaging_referrals: someone with an existing thread came back through an ad. */
  referral?: unknown
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
    parent_id?: string
    from?: { id?: string; name?: string }
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
    /** Events while another app (e.g. Meta Business AI) owns the thread. */
    standby?: FbMessagingEvent[]
    changes?: FbFeedChange[]
  }>
}

async function processFacebookWebhook(body: FbWebhookBody, scope: SocialWebhookScope) {
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
    // Meta's own test payloads (page id "0") go to the first config; a real
    // event for an unknown page is dropped — it used to land in whichever
    // account happened to come first.
    if (!config && pageId === "0") {
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
    if (!scopeAllows(scope, config.account_id)) {
      console.warn(`[Facebook] event for page ${pageId} was signed with another account's app secret — dropped`)
      continue
    }
    // Stored sealed (or, for an old row, plain) — see openStoredSecret.
    config = { ...config, access_token: openStoredSecret(config.access_token) }

    // Handle feed changes (post likes, comments, reactions)
    if (entry.changes?.length) {
      const feedChanges = entry.changes.filter((c) => c.field === "feed")
      // Comments on the Page's posts, kept for the Comments screen. The Page's
      // own replies come back here too and are skipped.
      for (const change of feedChanges) {
        const v = change.value
        if (v.item !== "comment" || typeof v.comment_id !== "string") continue
        const fromId = v.from?.id ?? v.sender_id ?? null
        if (fromId && fromId === (config.page_id ?? pageId)) continue
        if (v.verb === "remove") { await markCommentAtMeta(config.account_id, "facebook", v.comment_id, "removed"); continue }
        if (v.verb === "hide" || v.verb === "unhide") { await markCommentAtMeta(config.account_id, "facebook", v.comment_id, v.verb === "hide" ? "hidden" : "unhidden"); continue }
        if (v.verb !== "add" && v.verb !== "edited" && v.verb !== "edit") continue
        const saved = await saveIncomingComment({
          accountId: config.account_id, channel: "facebook", commentId: v.comment_id,
          parentId: v.parent_id && v.parent_id !== v.post_id ? v.parent_id : null, postId: v.post_id ?? null,
          fromId, fromName: v.from?.name ?? null, text: v.message ?? null,
          at: typeof v.created_time === "number" ? new Date(v.created_time < 1e12 ? v.created_time * 1000 : v.created_time) : null,
        })
        if (saved) {
          emitToAccount(config.account_id, "social_comment", { id: saved })
          fillPostDetails(config.account_id, "facebook", v.post_id, config.access_token).catch(() => {})
        }
      }
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

    // Standby: another app (Meta Business AI) owns these threads. The
    // messages are kept so the team sees them, but nothing here replies.
    const events: Array<{ event: FbMessagingEvent; standby: boolean }> = [
      ...(entry.messaging ?? []).map((event) => ({ event, standby: false })),
      ...(entry.standby ?? []).map((event) => ({ event, standby: true })),
    ]
    for (const { event, standby } of events) {
      const senderPsid = event.sender?.id
      // A malformed event must not stop the rest of the batch.
      if (!senderPsid) continue
      const pageSelf = config.page_id ?? pageId
      // A reply typed in the Messenger app or Business Suite (an echo):
      // added to the chat unless this CRM sent it (same Meta id).
      if (event.message?.is_echo || senderPsid === pageSelf) {
        if (event.message?.mid && event.recipient?.id) await processFbEcho(config.account_id, event.recipient.id, event.message, event.timestamp)
        continue
      }
      // Skip read/delivery receipts
      if (event.read || event.delivery) continue

      if (event.reaction || event.message_edit || event.message?.admin_text) {
        await processFbSideEvent(config.account_id, senderPsid, event)
        continue
      }

      // A returning customer came back through an ad, before writing anything.
      if (event.referral && !event.message && !event.postback) {
        await recordFbReferralEvent(config.account_id, senderPsid, event.referral, event.timestamp)
        continue
      }

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
          referral:          event.message.referral ?? null,
          standby,
          replyToMid:        event.message.reply_to?.mid ?? null,
        })
      }

      if (event.postback) {
        await processFbMessage({
          accountId:         config.account_id,
          accessToken:       config.access_token ?? "",
          senderPsid,
          messageId:         event.postback.mid ?? `fb_pb_${senderPsid}_${event.timestamp}`,
          text:              event.postback.title ?? null,
          attachments:       [],
          timestamp:         event.timestamp,
          quickReplyPayload: null,
          postbackPayload:   event.postback.payload,
          postbackTitle:     event.postback.title ?? null,
          referral:          event.postback.referral ?? null,
          standby,
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
  const { addTagsToContact } = await import("@/lib/contacts/tag-events")
  await addTagsToContact({ accountId, contactId: contact.id, tagIds: [adTag.id], source: "ad_lead" })

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
      // The form's ad. No WhatsApp number: a form fill arrives on no chat.
      ad_id: value.ad_id || null,
    },
  })

  void webhookWrote("facebook_lead_ads", accountId, { type: "lead", id: createdLead.id }, { op: "create", contact_id: contact.id, form_id: form?.id ?? null })

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

  // The same ad journey as chats (src/lib/ads/attribution.ts), and the
  // ad's name looked up. Never throws.
  if (value.ad_id) {
    await recordAdTouch({
      accountId,
      channel: "lead_form",
      externalId: leadgenId,
      referral: { adId: /^\d{5,30}$/.test(value.ad_id) ? value.ad_id : null, postId: null, sourceType: "lead_form", headline: form?.name ?? null, clickId: null, sourceUrl: null, mediaUrl: null,
        // From the ad set's placement above: certain only when it shows on one platform.
        platform: platform === "facebook" || platform === "instagram" ? platform : null },
      contactId: contact.id,
    })
  }

  emitToAccount(accountId, "lead", { eventType: "INSERT", new: createdLead })
}

/**
 * messaging_referrals: a customer who already has a thread opened it again
 * from an ad. Only an existing contact is recorded — a brand-new thread
 * carries its referral on the first message or postback instead.
 */
async function recordFbReferralEvent(accountId: string, psid: string, raw: unknown, timestamp: number) {
  const adReferral = referralFromMeta(raw)
  if (!adReferral) return
  try {
    const contact = await prisma.contact.findUnique({
      where: { contacts_account_facebook_id: { account_id: accountId, facebook_id: psid } },
      select: { id: true },
    })
    if (!contact) return
    const conversation = await prisma.conversation.findFirst({
      where: { account_id: accountId, contact_id: contact.id, channel: "facebook" },
      select: { id: true },
    })
    await recordAdTouch({
      accountId,
      channel: "messenger",
      // No message id on this event: the person and the moment identify it.
      externalId: `referral:${psid}:${timestamp}`,
      referral: adReferral,
      contactId: contact.id,
      conversationId: conversation?.id ?? null,
      at: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : undefined,
    })
  } catch (err) {
    console.error("[Facebook] ad referral not recorded:", err instanceof Error ? err.message : err)
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
  referral = null,
  standby = false,
  replyToMid = null,
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
  referral?:         unknown
  /** Another app owns the thread: keep the message, do not answer it. */
  standby?:          boolean
  /** The Meta id of the message the customer replied to. */
  replyToMid?:       string | null
}) {
  const ownerProfile = await prisma.profile.findFirst({
    where: { account_id: accountId },
    orderBy: { created_at: "asc" },
    select: { user_id: true },
  })
  if (!ownerProfile) return
  const ownerUserId = ownerProfile.user_id

  const existedBefore = await prisma.contact.findFirst({
    where: { account_id: accountId, facebook_id: senderPsid },
    select: { id: true },
  })
  const contact = await findOrCreateFbContact(accountId, ownerUserId, senderPsid, accessToken, !existedBefore)
  if (!contact) return
  const wasCreated = !existedBefore

  const conversation = await findOrCreateFbConversation(accountId, ownerUserId, contact.id)
  if (!conversation) return

  // Meta resends a notification it is not sure arrived (for up to 36
  // hours). The same message must not be saved twice or answered twice.
  if (messageId) {
    const already = await prisma.message.findFirst({
      where: { conversation_id: conversation.id, message_id: messageId },
      select: { id: true },
    })
    if (already) return
  }

  // Which ad brought them in (Click-to-Messenger). Never throws.
  const adReferral = referralFromMeta(referral)
  if (adReferral) {
    await recordAdTouch({
      accountId,
      channel: "messenger",
      externalId: messageId,
      referral: adReferral,
      contactId: contact.id,
      conversationId: conversation.id,
      at: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : undefined,
    })
  }

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
    const replyToId = await replyTargetId(conversation.id, replyToMid)
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
        ...(replyToId ? { reply_to_message_id: replyToId } : {}),
      },
    })
    emitToAccount(accountId, "message", { eventType: "INSERT", new: savedMsg, old: {} })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "P2002") return
    console.error("[Facebook] message insert failed:", err)
    return
  }

  // Several images in one message: the first is above, the rest follow.
  for (const [i, extra] of attachmentsToRows(attachments).slice(1).entries()) {
    const row = await prisma.message.create({
      data: { conversation_id: conversation.id, sender_type: "customer", content_type: extra.contentType, content_text: extra.label, media_url: extra.url, message_id: `${messageId}#${i + 2}`, status: "delivered", created_at: new Date(timestamp) },
    }).catch(() => null)
    if (row) emitToAccount(accountId, "message", { eventType: "INSERT", new: row, old: {} })
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

  // While Meta Business AI owns the thread, Meta refuses our replies
  // (and a "seen" tick from us would be wrong).
  if (standby) return

  // Mark seen
  if (accessToken) {
    fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(accessToken)}`, {
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

  const isFirstInboundMessage = msgCount <= 1
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId:         ownerUserId,
    contactId:      contact.id,
    conversationId: conversation.id,
    channel:        "facebook",
    message:        engineMessage,
    isFirstInboundMessage,
  }).catch((err) => {
    console.error("[Facebook] dispatchInboundToFlows error:", err)
    return { consumed: false as const, outcome: "no_match" as const }
  })

  // Automations, the same way as WhatsApp and Instagram: a flow that
  // consumed the message wins, so the customer never gets two replies.
  const triggers: ("new_contact_created" | "first_inbound_message" | "new_message_received" | "keyword_match")[] = []
  if (!flowResult.consumed) triggers.push("new_message_received", "keyword_match")
  if (wasCreated) triggers.unshift("new_contact_created")
  if (isFirstInboundMessage) triggers.unshift("first_inbound_message")
  for (const triggerType of triggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contact.id,
      context: { message_text: contentText ?? "", conversation_id: conversation.id },
    }).catch((err) => console.error("[automations] Messenger dispatch failed:", err))
  }
}

async function findOrCreateFbContact(
  accountId: string,
  ownerUserId: string,
  psid: string,
  accessToken: string,
  isNew: boolean,
) {
  // The real name, fetched once for a new contact (not on every message).
  // Requires "Business Asset User Profile Access" feature on the Meta app.
  let displayName: string | null = null
  if (accessToken && isNew && /^\d{1,30}$/.test(psid)) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${psid}?fields=name,first_name,last_name&access_token=${encodeURIComponent(accessToken)}`,
        { cache: "no-store" }
      )
      if (res.ok) {
        const data = await res.json() as { name?: string; first_name?: string; last_name?: string }
        const full = data.name ?? [data.first_name, data.last_name].filter(Boolean).join(" ")
        if (full) displayName = full.slice(0, 100)
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
      // An existing contact keeps its name: an agent may have corrected it.
      update: {},
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

/** The Messenger contact and conversation for a PSID, if they exist (never created here). */
async function existingFbThread(accountId: string, psid: string): Promise<{ contactId: string; conversationId: string } | null> {
  const contact = await prisma.contact.findFirst({ where: { account_id: accountId, facebook_id: psid }, select: { id: true } })
  if (!contact) return null
  const conv = await prisma.conversation.findFirst({ where: { account_id: accountId, contact_id: contact.id, channel: "facebook" }, select: { id: true } })
  return conv ? { contactId: contact.id, conversationId: conv.id } : null
}

/** A reply typed in the Messenger app / Business Suite. */
async function processFbEcho(accountId: string, recipientPsid: string, message: FbMessage, timestamp: number) {
  const thread = await existingFbThread(accountId, recipientPsid)
  if (!thread) return
  const first = attachmentsToRows(message.attachments)[0]
  await saveSocialEcho({
    accountId, conversationId: thread.conversationId, mid: message.mid,
    text: message.text ?? first?.label ?? null, mediaUrl: first?.url ?? null, contentType: first?.contentType ?? "text",
    at: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date(),
  })
}

/** Reactions, edits and Business AI hand-overs on an existing chat. */
async function processFbSideEvent(accountId: string, psid: string, event: FbMessagingEvent) {
  const thread = await existingFbThread(accountId, psid)
  if (!thread) return
  if (event.reaction?.mid) {
    await applySocialReaction({ accountId, conversationId: thread.conversationId, contactId: thread.contactId, targetMid: event.reaction.mid, emoji: event.reaction.action === "unreact" ? null : event.reaction.emoji ?? null })
  }
  if (event.message_edit?.mid && typeof event.message_edit.text === "string") {
    await applySocialEdit({ accountId, conversationId: thread.conversationId, mid: event.message_edit.mid, text: event.message_edit.text })
  }
  if (event.message?.admin_text) {
    await noteBusinessAiHandoff({ accountId, conversationId: thread.conversationId, reason: event.message.handoff_reason ?? null, adminText: event.message.admin_text })
  }
}
