import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { onceSchemaPatch } from "@/lib/db/schema-patch"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id: conversationId } = await params

    // Verify the conversation belongs to the caller's account.
    // Agents can only read messages from conversations assigned to them.
    const conversation = await ctx.db.conversation.findFirst({
      where: {
        id: conversationId,
        account_id: ctx.accountId,
        ...(ctx.role === "agent" ? { assigned_agent_id: ctx.userId } : {}),
      },
      select: { id: true },
    })
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      )
    }

    // The raw SELECT below names deleted_at, so the column has to exist
    // even on a database whose migration has not been run. Applied once
    // per process rather than once per click — this is an ALTER TABLE
    // against the largest table in the database, and it used to run
    // every single time an agent opened a conversation.
    //
    // The failure is still swallowed: on a deployment whose database
    // user cannot ALTER, the column is already there and the read
    // succeeds regardless.
    await onceSchemaPatch('messages.deleted_at', () => ctx.db.$executeRaw`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `).catch(() => {})

    // LEFT JOIN LATERAL (not a plain JOIN) so a template with multiple rows
    // (different languages) can't multiply the message row — this only
    // ever contributes at most one `buttons` value per message. Template
    // messages otherwise render with no visibility into what buttons were
    // actually sent (quick-reply/URL/phone/etc.) — the inbox only showed
    // the body text, never the button labels the customer would have seen.
    const messages = await ctx.db.$queryRaw<unknown[]>`
      SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.content_type,
             m.content_text, m.media_url, m.media_mime_type, m.media_filename,
             m.template_name, m.message_id, m.status, m.broadcast_id,
             m.interactive_reply_id, m.reply_to_message_id, m.created_at, m.deleted_at,
             m.email_subject, m.transcript, m.order_snapshot, mt.buttons AS template_buttons,
             m.detected_lang, m.translated_text, m.translated_lang
      FROM messages m
      LEFT JOIN LATERAL (
        SELECT buttons FROM message_templates
        WHERE name = m.template_name AND account_id = ${ctx.accountId}::uuid
        LIMIT 1
      ) mt ON m.template_name IS NOT NULL
      WHERE m.conversation_id = ${conversationId}::uuid
      ORDER BY m.created_at ASC
    `

    return NextResponse.json(messages)
  } catch (err) {
    return toErrorResponse(err)
  }
}
