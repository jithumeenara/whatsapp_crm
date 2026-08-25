import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/contacts/[id]/timeline
 *
 * Read-only merged view of a contact's full message history across every
 * channel (WhatsApp, Instagram, Facebook, SMS, Email, RCS). Each channel
 * still owns its own `Conversation` row (that separation is intentional —
 * see the channel-scoped conversation lookup fix in the webhook handlers,
 * which exists specifically to stop different channels' threads from
 * colliding into one record). This endpoint does NOT merge those records;
 * it aggregates messages from all of a contact's conversations and tags
 * each one with the channel + conversation it came from, so the inbox can
 * offer a "view full history" mode without touching identity data.
 *
 * Replying always happens against a single, specific conversation (the
 * existing per-conversation composer) — this endpoint is read-only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id: contactId } = await params

    const contact = await ctx.db.contact.findFirst({
      where: { id: contactId, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 })
    }

    // Agents can only see conversations assigned to them — same restriction
    // as the single-conversation messages endpoint.
    const conversations = await ctx.db.conversation.findMany({
      where: {
        contact_id: contactId,
        account_id: ctx.accountId,
        ...(ctx.role === "agent" ? { assigned_agent_id: ctx.userId } : {}),
      },
      select: { id: true, channel: true },
    })

    if (conversations.length === 0) {
      return NextResponse.json({ channels: [], messages: [] })
    }

    const convIds = conversations.map((c) => c.id)
    const channelByConvId = new Map(conversations.map((c) => [c.id, c.channel]))

    // Raw query ensures deleted_at is included even before prisma generate
    // (matches the pattern in the single-conversation messages route).
    await ctx.db.$executeRaw`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `.catch(() => {})

    const messages = await ctx.db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.content_type,
             m.content_text, m.media_url, m.media_mime_type, m.media_filename,
             m.template_name, m.message_id, m.status, m.broadcast_id,
             m.interactive_reply_id, m.reply_to_message_id, m.created_at, m.deleted_at,
             m.email_subject, mt.buttons AS template_buttons
      FROM messages m
      LEFT JOIN LATERAL (
        SELECT buttons FROM message_templates
        WHERE name = m.template_name AND account_id = ${ctx.accountId}::uuid
        LIMIT 1
      ) mt ON m.template_name IS NOT NULL
      WHERE m.conversation_id = ANY(${convIds}::uuid[])
      ORDER BY m.created_at ASC
    `

    const tagged = messages.map((m) => ({
      ...m,
      channel: channelByConvId.get(m.conversation_id as string) ?? "whatsapp",
    }))

    return NextResponse.json({
      channels: [...new Set(conversations.map((c) => c.channel))],
      messages: tagged,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
