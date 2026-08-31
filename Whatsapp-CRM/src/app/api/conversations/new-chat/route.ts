import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe"
import { sanitizePhoneForMeta, isValidE164 } from "@/lib/whatsapp/phone-utils"
import { emitToAccount } from "@/lib/socket"
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * POST /api/conversations/new-chat
 *
 * Finds or creates a Contact + WhatsApp Conversation for a manually
 * entered phone number, so the caller can then send a template message
 * to it via the existing /api/whatsapp/send (which requires a
 * conversation_id and never creates one itself).
 *
 * There is no separate "is this number on WhatsApp" endpoint in Meta's
 * Cloud API — the phone format is validated here, but the real proof
 * is the template send that follows this call actually succeeding.
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const userId = session.user.id

    const limit = checkRateLimit(`new-chat:${userId}`, RATE_LIMITS.newChat)
    if (!limit.success) return rateLimitResponse(limit)

    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    const accountId = profile?.account_id ?? ""
    if (!accountId) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      )
    }

    const body = await request.json().catch(() => null)
    const rawPhone = typeof body?.phone === "string" ? body.phone.trim() : ""
    const name = typeof body?.name === "string" ? body.name.trim() : ""

    if (!rawPhone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 })
    }

    const sanitized = sanitizePhoneForMeta(rawPhone)
    if (!isValidE164(sanitized)) {
      return NextResponse.json(
        { error: "Enter a valid phone number with country code, e.g. 919876543210" },
        { status: 400 },
      )
    }

    // Find or create the contact.
    let contact = await findExistingContact(accountId, sanitized)
    let contactCreated = false
    if (!contact) {
      try {
        contact = await prisma.contact.create({
          data: {
            account_id: accountId,
            user_id: userId,
            phone: sanitized,
            phone_normalized: sanitized,
            name: name || sanitized,
          },
        })
        contactCreated = true
      } catch (err) {
        // Lost a race with a concurrent create (e.g. two agents starting
        // a chat to the same new number at once) — re-resolve.
        if (isUniqueViolation(err)) {
          contact = await findExistingContact(accountId, sanitized)
        }
        if (!contact) {
          console.error("[new-chat] contact create failed:", err)
          return NextResponse.json({ error: "Could not create contact" }, { status: 500 })
        }
      }
    }

    if (contactCreated) {
      emitToAccount(accountId, "contact", { eventType: "INSERT", new: contact, old: {} })
    }

    // Find or create the WhatsApp conversation for this contact —
    // scoped by channel, matching the webhook's own
    // findOrCreateConversation so a contact shared across channels
    // never reuses another channel's conversation row.
    let conversation = await prisma.conversation.findFirst({
      where: { account_id: accountId, contact_id: contact.id, channel: "whatsapp" },
    })
    let conversationCreated = false
    if (!conversation) {
      try {
        conversation = await prisma.conversation.create({
          data: {
            account_id: accountId,
            user_id: userId,
            contact_id: contact.id,
            channel: "whatsapp",
          },
        })
        conversationCreated = true
      } catch (err) {
        console.error("[new-chat] conversation create failed:", err)
        return NextResponse.json({ error: "Could not create conversation" }, { status: 500 })
      }
    }

    if (conversationCreated) {
      const full = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        include: { contact: true },
      })
      emitToAccount(accountId, "conversation", { eventType: "INSERT", new: full ?? conversation, old: {} })
    }

    return NextResponse.json({
      conversation_id: conversation.id,
      contact_id: contact.id,
      existing: !conversationCreated,
    })
  } catch (error) {
    console.error("Error in new-chat POST:", error)
    return NextResponse.json({ error: "Failed to start new chat" }, { status: 500 })
  }
}
