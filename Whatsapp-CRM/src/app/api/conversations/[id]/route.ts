import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { NextRequest, NextResponse } from "next/server"
import { sendPushToUser } from "@/lib/push"

/**
 * GET /api/conversations/[id]
 * Returns a single conversation with its contact join.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer")
    const { id } = await params

    const conversation = await ctx.db.conversation.findFirst({
      where: {
        id,
        account_id: ctx.accountId,
        ...(ctx.role === "agent" ? { assigned_agent_id: ctx.userId } : {}),
      },
      include: { contact: true },
    })
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(conversation)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params

    const conversation = await ctx.db.conversation.findFirst({
      where: {
        id,
        account_id: ctx.accountId,
        ...(ctx.role === "agent" ? { assigned_agent_id: ctx.userId } : {}),
      },
      include: { contact: { select: { name: true, phone: true } } },
    })
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      )
    }

    const body = (await req.json()) as {
      status?: string
      assigned_agent_id?: string | null
      unread_count?: number
    }

    const data: Record<string, unknown> = {}
    if (body.status !== undefined) data.status = body.status
    if ("assigned_agent_id" in body) data.assigned_agent_id = body.assigned_agent_id
    if (body.unread_count !== undefined) data.unread_count = body.unread_count

    const updated = await ctx.db.conversation.update({
      where: { id },
      data,
    })

    // Push notification when a new agent is assigned
    if (
      "assigned_agent_id" in body &&
      body.assigned_agent_id &&
      body.assigned_agent_id !== conversation.assigned_agent_id &&
      body.assigned_agent_id !== ctx.userId
    ) {
      const contactName = conversation.contact?.name ?? conversation.contact?.phone ?? "a contact"
      void sendPushToUser(body.assigned_agent_id, {
        title: "Conversation Assigned to You",
        body: `New conversation with ${contactName}`,
        tag: `conv-${id}`,
        data: { type: "assignment", conversationId: id },
      })
    }

    return NextResponse.json(updated)
  } catch (err) {
    return toErrorResponse(err)
  }
}
