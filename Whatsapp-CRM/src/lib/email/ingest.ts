/**
 * An email that arrived, into the Inbox: the contact, the conversation,
 * the message, then chatbots and automations — the same for every way
 * email reaches this app (SendGrid Inbound Parse, a connected Microsoft
 * mailbox).
 */
import { prisma } from "@/lib/db"
import { emitToAccount } from "@/lib/socket"
import { dispatchInboundToFlows } from "@/lib/flows/engine"
import { runAutomationsForTrigger } from "@/lib/automations/engine"
import crypto from "crypto"

export async function processInbound(
  accountId: string,
  configOwnerUserId: string,
  fields: {
    fromEmail: string
    subject: string
    text: string
    html: string | null
    /** The provider's id for this email (e.g. its Internet Message-ID).
     *  When given, an email already stored is not stored twice — a
     *  notification delivered twice is common. */
    providerMessageId?: string | null
  },
) {
  if (fields.providerMessageId) {
    const seen = await prisma.message.findFirst({
      where: { message_id: fields.providerMessageId, conversation: { account_id: accountId } },
      select: { id: true },
    })
    if (seen) return
  }

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
        message_id: fields.providerMessageId ?? null,
        status: "delivered",
      },
    })
    emitToAccount(accountId, "message", { eventType: "INSERT", new: savedMsg, old: {} })
  } catch (err) {
    console.error("[email inbound] message insert failed:", err)
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
    console.error("[email inbound] conversation update failed:", err)
  }

  // No provider-supplied message id for Inbound Parse — synthesize a unique
  // one so the flow engine's idempotency check doesn't treat every inbound
  // email from this contact as a duplicate of the first.
  const idempotencyId = fields.providerMessageId || crypto.randomUUID()

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
        opt_in_status: "opted_in",
        opt_in_source: "email_inbound",
        opt_in_at: new Date(),
      },
    })
    return { contact, wasCreated: true }
  } catch (err) {
    console.error("[email inbound] contact create failed:", err)
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
    console.error("[email inbound] conversation create failed:", err)
    return null
  }
}
