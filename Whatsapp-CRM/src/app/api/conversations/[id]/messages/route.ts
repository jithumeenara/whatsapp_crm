import { requireRole, toErrorResponse } from "@/lib/auth/account"
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

    // Raw query ensures deleted_at is included even before prisma generate
    await ctx.db.$executeRaw`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `.catch(() => {})

    const messages = await ctx.db.$queryRaw<unknown[]>`
      SELECT id, conversation_id, sender_type, sender_id, content_type,
             content_text, media_url, template_name, message_id, status,
             interactive_reply_id, reply_to_message_id, created_at, deleted_at
      FROM messages
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at ASC
    `

    return NextResponse.json(messages)
  } catch (err) {
    return toErrorResponse(err)
  }
}
