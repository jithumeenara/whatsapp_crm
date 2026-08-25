import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe"
import { normalizePhone } from "@/lib/whatsapp/phone-utils"
import { dispatchInboundToFlows } from "@/lib/flows/engine"
import { runAutomationsForTrigger } from "@/lib/automations/engine"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import { verifyTextBeeSignature } from "@/lib/messaging/channels/sms"
import crypto from "crypto"

/**
 * Inbound SMS webhook — shared by both MSG91 and TextBee.
 *
 * The per-account secret in the URL path resolves which account a request
 * belongs to for both providers (MSG91's own webhook auth mechanism isn't
 * confirmed against current docs, so this URL-secret is a portable
 * substitute that works regardless of whatever MSG91-native scheme exists).
 * For TextBee specifically, the same secret is also registered as the
 * webhook's HMAC signing secret (see registerTextBeeWebhook in sms.ts), so
 * TextBee requests get real signature verification on top of the URL
 * secret — checked below via the `X-Signature` header.
 *
 * MSG91's exact inbound payload field names aren't confirmed against
 * current docs either — extractInboundFields tries the commonly-seen
 * variants defensively. TextBee's shape (from textbee.dev/docs/webhooks) is
 * exact: `{ event: "MESSAGE_RECEIVED", data: { sender, message, _id, ... } }`.
 */

async function resolveAccountBySecret(secret: string) {
  return prisma.smsConfig.findFirst({
    where: { webhook_secret: secret },
    select: { account_id: true, user_id: true, provider: true },
  })
}

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  const xri = request.headers.get("x-real-ip")
  if (xri) return xri.trim()
  return "unknown"
}

function extractInboundFields(payload: Record<string, unknown>): { from: string; text: string; messageId: string | null } | null {
  // TextBee's webhook envelope: { event: "MESSAGE_RECEIVED", data: {...} }.
  // Only MESSAGE_RECEIVED is ever subscribed to (registerTextBeeWebhook),
  // but a stray delivery-status event should be acked, not misparsed as a
  // customer message — bail out here rather than falling through to the
  // MSG91-shaped guesses below.
  if (payload.event && typeof payload.data === "object" && payload.data) {
    if (payload.event !== "MESSAGE_RECEIVED") return null
    const data = payload.data as Record<string, unknown>
    const from = String(data.sender ?? "").trim()
    const text = String(data.message ?? "").trim()
    const messageId = data._id ?? null
    if (!from || !text) return null
    return { from, text, messageId: messageId ? String(messageId) : null }
  }

  const from = String(payload.from ?? payload.sender ?? payload.mobile ?? payload.msisdn ?? "").trim()
  const text = String(payload.text ?? payload.message ?? payload.content ?? payload.body ?? "").trim()
  const messageId = payload.request_id ?? payload.message_id ?? payload.id ?? null
  if (!from || !text) return null
  return { from, text, messageId: messageId ? String(messageId) : null }
}

/** Simple reachability check — some providers ping the URL before saving it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params
  const config = await resolveAccountBySecret(secret)
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ status: "ok" })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  // Per-IP limit before anything else — this endpoint's auth is a
  // URL-embedded secret rather than a cryptographic signature (see the
  // module comment), so this also slows secret-guessing brute force,
  // belt-and-braces alongside the secret's own entropy.
  const limit = checkRateLimit(`sms-webhook:${getClientIp(request)}`, RATE_LIMITS.inboundWebhookSecret)
  if (!limit.success) return rateLimitResponse(limit)

  const { secret } = await params
  const config = await resolveAccountBySecret(secret)
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const rawBody = await request.text()

  // TextBee registers this same URL secret as its HMAC signing secret (see
  // registerTextBeeWebhook) — verify it, fail closed, same as every other
  // provider in this app that supports a real signature scheme.
  if (config.provider === "textbee") {
    const signature = request.headers.get("x-signature")
    if (!verifyTextBeeSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // Fall back to form-encoded — some SMS providers POST that shape instead.
    payload = Object.fromEntries(new URLSearchParams(rawBody))
  }

  const fields = extractInboundFields(payload)
  if (!fields) {
    // Ack anyway — a malformed/unrecognized payload shouldn't make the
    // provider retry indefinitely, just log it for diagnosis.
    console.warn("[sms webhook] could not extract from/text from payload:", payload)
    return NextResponse.json({ status: "received" })
  }

  processInbound(config.account_id, config.user_id, fields).catch((err) =>
    console.error("[sms webhook] processing failed:", err)
  )

  return NextResponse.json({ status: "received" })
}

async function processInbound(
  accountId: string,
  configOwnerUserId: string,
  fields: { from: string; text: string; messageId: string | null },
) {
  const senderPhone = normalizePhone(fields.from)
  if (!senderPhone) return

  const contactOutcome = await findOrCreateSmsContact(accountId, configOwnerUserId, senderPhone)
  if (!contactOutcome) return
  const { contact, wasCreated } = contactOutcome

  const conversation = await findOrCreateSmsConversation(accountId, configOwnerUserId, contact.id)
  if (!conversation) return

  const priorCount = await prisma.message.count({ where: { conversation_id: conversation.id, sender_type: "customer" } })
  const isFirstInboundMessage = priorCount === 0

  let savedMsg
  try {
    savedMsg = await prisma.message.create({
      data: {
        conversation_id: conversation.id,
        sender_type: "customer",
        content_type: "text",
        content_text: fields.text,
        message_id: fields.messageId,
        status: "delivered",
      },
    })
    emitToAccount(accountId, "message", { eventType: "INSERT", new: savedMsg, old: {} })
  } catch (err) {
    console.error("[sms webhook] message insert failed:", err)
    return
  }

  try {
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        last_message_text: fields.text,
        last_message_at: new Date(),
        unread_count: { increment: 1 },
      },
    })
    emitToAccount(accountId, "conversation", { eventType: "UPDATE", new: updatedConv, old: {} })
  } catch (err) {
    console.error("[sms webhook] conversation update failed:", err)
  }

  // Fall back to a random id when the provider doesn't supply one — an
  // empty/constant string here would make the idempotency check treat every
  // no-ID message from this contact as a duplicate of the first.
  const idempotencyId = fields.messageId ?? crypto.randomUUID()

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contact.id,
    conversationId: conversation.id,
    channel: "sms",
    message: { kind: "text", text: fields.text, meta_message_id: idempotencyId },
    isFirstInboundMessage,
  })

  const automationTriggers: ("new_contact_created" | "first_inbound_message" | "new_message_received" | "keyword_match")[] = []
  if (!flowResult.consumed) automationTriggers.push("new_message_received", "keyword_match")
  if (wasCreated) automationTriggers.unshift("new_contact_created")
  if (isFirstInboundMessage) automationTriggers.unshift("first_inbound_message")
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contact.id,
      context: { message_text: fields.text, conversation_id: conversation.id },
    }).catch((err) => console.error("[automations] dispatch failed:", err))
  }
}

async function findOrCreateSmsContact(accountId: string, ownerUserId: string, phone: string) {
  const existing = await findExistingContact(accountId, phone)
  if (existing) return { contact: existing, wasCreated: false }

  try {
    const contact = await prisma.contact.create({
      data: {
        account_id: accountId,
        user_id: ownerUserId,
        phone,
        phone_normalized: phone.replace(/\D/g, ""),
        name: phone,
      },
    })
    return { contact, wasCreated: true }
  } catch (err) {
    if (isUniqueViolation(err)) {
      const found = await findExistingContact(accountId, phone)
      if (found) return { contact: found, wasCreated: false }
    }
    console.error("[sms webhook] contact create failed:", err)
    return null
  }
}

async function findOrCreateSmsConversation(accountId: string, ownerUserId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId, channel: "sms" },
  })
  if (existing) return existing

  try {
    return await prisma.conversation.create({
      data: { account_id: accountId, user_id: ownerUserId, contact_id: contactId, channel: "sms" },
    })
  } catch (err) {
    console.error("[sms webhook] conversation create failed:", err)
    return null
  }
}
