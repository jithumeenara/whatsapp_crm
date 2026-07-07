import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * GET /api/conversations/[id]/reactions
 * Returns all message reactions for a conversation.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id } = await params

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        account_id: ctx.accountId,
        ...(ctx.role === "agent" ? { assigned_agent_id: ctx.userId } : {}),
      },
      select: { id: true },
    })
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const reactions = await prisma.messageReaction.findMany({
      where: { conversation_id: id },
    })

    return NextResponse.json({ reactions })
  } catch (err) {
    return toErrorResponse(err)
  }
}
