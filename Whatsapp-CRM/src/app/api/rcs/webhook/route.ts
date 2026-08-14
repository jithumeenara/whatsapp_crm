import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe"
import { normalizePhone } from "@/lib/whatsapp/phone-utils"
import { dispatchInboundToFlows } from "@/lib/flows/engine"
import { runAutomationsForTrigger } from "@/lib/automations/engine"
import { decrypt } from "@/lib/whatsapp/encryption"
import { verifyTwilioSignature } from "@/lib/messaging/channels/rcs"
import crypto from "crypto"

/**
 * Inbound RCS (and SMS/MMS-fallback) webhook — Twilio.
 *
 * Unlike SMS/Email, this has a real, well-documented signature scheme
 * (twilio.validateRequest, HMAC over the exact webhook URL + sorted POST
 * params) — no per-account URL secret needed. The account is instead
 * resolved by matching the receiving `To` number or `MessagingServiceSid`
 * against RcsConfig, same as WhatsApp resolves accounts by phone_number_id.
 */

async function resolveAccountByRecipient(to: string | null, messagingServiceSid: string | null) {
  if (messagingServiceSid) {
    const byService = await prisma.rcsConfig.findFirst({
      where: { messaging_service_sid: messagingServiceSid },
      select: { account_id: true, user_id: true, account_sid: true, auth_token: true },
    })
    if (byService) return byService
  }
  if (to) {
    const byNumber = await prisma.rcsConfig.findFirst({
      where: { from_number: to },
      select: { account_id: true, user_id: true, account_sid: true, auth_token: true },
    })
    if (byNumber) return byNumber
  }
  return null
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody))

  const to = params.To ?? null
  const messagingServiceSid = params.MessagingServiceSid ?? null
  const config = await resolveAccountByRecipient(to, messagingServiceSid)
  if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let authToken: string
  try {
    authToken = decrypt(config.auth_token)
  } catch {
    console.error("[rcs webhook] could not decrypt auth token for account:", config.account_id)
    return NextResponse.json({ error: "Configuration error" }, { status: 500 })
  }

  const signature = request.headers.get("x-twilio-signature")
  // Twilio signs the exact URL it was configured to POST to — behind a
  // reverse proxy, request.url may not match that exactly (protocol/host
  // rewriting). If validation keeps failing in production despite correct
  // credentials, this is the first thing to check.
  const isValid = verifyTwilioSignature({ authToken, signature, url: request.url, params })
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const from = params.From ?? ""
  const body = (params.Body ?? "").trim()
  const messageSid = params.MessageSid || params.SmsMessageSid || null
  if (!from || !body) {
    return NextResponse.json({ status: "received" })
  }

  processInbound(config.account_id, config.user_id, { from, body, messageSid }).catch((err) =>
    console.error("[rcs webhook] processing failed:", err)
  )

  return NextResponse.json({ status: "received" })
}

async function processInbound(
  accountId: string,
  configOwnerUserId: string,
  fields: { from: string; body: string; messageSid: string | null },
) {
  const senderPhone = normalizePhone(fields.from)
  if (!senderPhone) return

  const contactOutcome = await findOrCreateRcsContact(accountId, configOwnerUserId, senderPhone)
  if (!contactOutcome) return
  const { contact, wasCreated } = contactOutcome

  const conversation = await findOrCreateRcsConversation(accountId, configOwnerUserId, contact.id)
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
        content_text: fields.body,
        message_id: fields.messageSid,
        status: "delivered",
      },
    })
    emitToAccount(accountId, "message", { eventType: "INSERT", new: savedMsg, old: {} })
  } catch (err) {
    console.error("[rcs webhook] message insert failed:", err)
    return
  }

  try {
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { last_message_text: fields.body, last_message_at: new Date(), unread_count: { increment: 1 } },
    })
    emitToAccount(accountId, "conversation", { eventType: "UPDATE", new: updatedConv, old: {} })
  } catch (err) {
    console.error("[rcs webhook] conversation update failed:", err)
  }

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contact.id,
    conversationId: conversation.id,
    channel: "rcs",
    message: { kind: "text", text: fields.body, meta_message_id: fields.messageSid ?? crypto.randomUUID() },
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
      context: { message_text: fields.body, conversation_id: conversation.id },
    }).catch((err) => console.error("[automations] dispatch failed:", err))
  }
}

async function findOrCreateRcsContact(accountId: string, ownerUserId: string, phone: string) {
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
    console.error("[rcs webhook] contact create failed:", err)
    return null
  }
}

async function findOrCreateRcsConversation(accountId: string, ownerUserId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { account_id: accountId, contact_id: contactId, channel: "rcs" },
  })
  if (existing) return existing

  try {
    return await prisma.conversation.create({
      data: { account_id: accountId, user_id: ownerUserId, contact_id: contactId, channel: "rcs" },
    })
  } catch (err) {
    console.error("[rcs webhook] conversation create failed:", err)
    return null
  }
}
