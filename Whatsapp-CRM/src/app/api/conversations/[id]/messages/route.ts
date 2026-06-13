import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id: conversationId } = await params

    // Verify the conversation belongs to the caller's account
    const conversation = await ctx.db.conversation.findFirst({
      where: { id: conversationId, account_id: ctx.accountId },
      select: { id: true },
    })
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      )
    }

    const messages = await ctx.db.message.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: "asc" },
    })

    return NextResponse.json(messages)
  } catch (err) {
    return toErrorResponse(err)
  }
}
