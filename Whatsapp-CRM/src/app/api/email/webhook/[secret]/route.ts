import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { dispatchInboundToFlows } from "@/lib/flows/engine"
import { runAutomationsForTrigger } from "@/lib/automations/engine"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"
import crypto from "crypto"

/**
 * Inbound email webhook — SendGrid Inbound Parse.
 *
 * Inbound Parse has no signature header by default (unlike SendGrid's
 * separate Event Webhook, which uses Ed25519 and isn't built here — see
 * EmailConfig.webhook_public_key, a stretch item). The per-account secret in
 * the URL path is the substitute: both authenticates the request and
 * resolves which account it belongs to.
 */

async function resolveAccountBySecret(secret: string) {
  return prisma.emailConfig.findFirst({
    where: { inbound_secret: secret },
    select: { account_id: true, user_id: true },
  })
}

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  const xri = request.headers.get("x-real-ip")
  if (xri) return xri.trim()
  return "unknown"
}

/** Extracts a bare email address from SendGrid's `"Name" <email@x.com>` From format. */
function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1] : raw).trim().toLowerCase()
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  // Per-IP limit before anything else — this endpoint's auth is a
  // URL-embedded secret rather than a cryptographic signature (see the
  // module comment), so this also slows secret-guessing brute force,
  // belt-and-braces alongside the secret's own entropy.
  const limit = checkRateLimit(`email-webhook:${getClientIp(request)}`, RATE_LIMITS.inboundWebhookSecret)
  if (!limit.success) return rateLimitResponse(limit)

  const { secret } = await params
  const config = await resolveAccountBySecret(secret)
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    console.error("[email webhook] failed to parse form data:", err)
    return NextResponse.json({ status: "received" })
  }

  const fromRaw = String(form.get("from") ?? "")
  const subject = String(form.get("subject") ?? "")
  const text = String(form.get("text") ?? "").trim()
  const html = String(form.get("html") ?? "") || null

  const fromEmail = extractEmailAddress(fromRaw)
  if (!fromEmail || !text) {
    console.warn("[email webhook] missing from/text in Inbound Parse payload")
    return NextResponse.json({ status: "received" })
  }

  processInbound(config.account_id, config.user_id, { fromEmail, subject, text, html }).catch((err) =>
    console.error("[email webhook] processing failed:", err)
  )

  return NextResponse.json({ status: "received" })
}

async function processInbound(
  accountId: string,
  configOwnerUserId: string,
  fields: { fromEmail: string; subject: string; text: string; html: string | null },
) {
  const contactOutcome = await findOrCreateEmailContact(accountId, configOwnerUserId, fields.fromEmail)
  if (!contactOutcome) return
  const { contact, wasCreated } = contactOutcome

  const conversation = await findOrCreateEmailConversation(accountId, configOwnerUserId, contact.id)
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
        email_subject: fields.subject || null,
        status: "delivered",
      },
    })
    emitToAccount(accountId, "message", { eventType: "INSERT", new: savedMsg, old: {} })
  } catch (err) {
    console.error("[email webhook] message insert failed:", err)
    return
  }

  try {
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        last_message_text: fields.subject ? `${fields.subject}: ${fields.text}`.slice(0, 200) : fields.text,
        last_message_at: new Date(),
        unread_count: { increment: 1 },
      },
    })
    emitToAccount(accountId, "conversation", { eventType: "UPDATE", new: updatedConv, old: {} })
  } catch (err) {
    console.error("[email webhook] conversation update failed:", err)
  }

  // No provider-supplied message id for Inbound Parse — synthesize a unique
  // one so the flow engine's idempotency check doesn't treat every inbound
  // email from this contact as a duplicate of the first.
  const idempotencyId = crypto.randomUUID()

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contact.id,
    conversationId: conversation.id,
    channel: "email",
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

async function findOrCreateEmailContact(accountId: string, ownerUserId: string, email: string) {
  const existing = await prisma.contact.findFirst({ where: { account_id: accountId, email } })
  if (existing) return { contact: existing, wasCreated: false }

  try {
    // Contact.phone has no default and no NULL fallback in this schema — a
    // placeholder derived from the email keeps the row valid without
    // colliding with real phone numbers or other email-only contacts
    // (uniqueness is scoped by account_id + phone_normalized, and this
    // placeholder is never a real E.164 number so it won't collide with one).
    const contact = await prisma.contact.create({
      data: {
        account_id: accountId,
        user_id: ownerUserId,
        phone: `email:${email}`,
        email,
        name: email,
      },
    })
    return { contact, wasCreated: true }
  } catch (err) {
    console.error("[email webhook] contact create failed:", err)
    const found = await prisma.contact.findFirst({ where: { account_id: accountId, email } })
    return found ? { contact: found, wasCreated: false } : null
  }
}

async function findOrCreateEmailConversation(accountId: string, ownerUserId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId, channel: "email" },
  })
  if (existing) return existing

  try {
    return await prisma.conversation.create({
      data: { account_id: accountId, user_id: ownerUserId, contact_id: contactId, channel: "email" },
    })
  } catch (err) {
    console.error("[email webhook] conversation create failed:", err)
    return null
  }
}
