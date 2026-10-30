import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { hasMinRole } from "@/lib/auth/roles"
import { NextRequest, NextResponse } from "next/server"
import { CONVERSATION_STATUSES, isOneOf } from "@/lib/status-lists"
import { sendPushToUser } from "@/lib/push"
import { requestFeedback } from "@/lib/ai/csat"

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
    if (body.status !== undefined) {
      if (!isOneOf(CONVERSATION_STATUSES, body.status)) {
        return NextResponse.json({ error: `status must be one of: ${CONVERSATION_STATUSES.join(", ")}` }, { status: 400 })
      }
      data.status = body.status
    }
    if ("assigned_agent_id" in body) {
      const next = body.assigned_agent_id ?? null
      if (next !== null && typeof next !== "string") {
        return NextResponse.json({ error: "assigned_agent_id must be a user id or null" }, { status: 400 })
      }
      // An agent (who only reaches their own chats here) may keep it or
      // give it back; handing it to a colleague is a supervisor's call.
      if (!hasMinRole(ctx.role, "supervisor") && next !== null && next !== ctx.userId) {
        return NextResponse.json({ error: "Only a supervisor can move a conversation between people" }, { status: 403 })
      }
      // The person must be in this account — the assignment push below
      // carries this account's customer's name to them.
      if (next !== null) {
        const member = await ctx.db.profile.findFirst({ where: { user_id: next, account_id: ctx.accountId }, select: { user_id: true } })
        if (!member) return NextResponse.json({ error: "That person is not in this account" }, { status: 400 })
      }
      data.assigned_agent_id = next
    }
    if (body.unread_count !== undefined) {
      if (!Number.isInteger(body.unread_count) || body.unread_count < 0) {
        return NextResponse.json({ error: "unread_count must be a whole number, 0 or more" }, { status: 400 })
      }
      data.unread_count = body.unread_count
    }

    const updated = await ctx.db.conversation.update({
      where: { id },
      data,
    })

    // Closing a conversation is the one moment the customer has an
    // opinion worth asking for, and the one moment asking is not an
    // interruption.
    //
    // Deliberately not awaited: the agent pressed Close and should see it
    // close. Sending a WhatsApp message takes a network round trip, and a
    // survey is never worth making somebody wait for. requestFeedback
    // swallows its own failures and declines on its own if this
    // conversation was asked recently.
    if (
      body.status === "closed" &&
      conversation.status !== "closed"
    ) {
      void requestFeedback({ accountId: ctx.accountId, conversationId: id }).catch(
        (err: unknown) => {
          console.warn(
            "[csat] could not ask for feedback on close:",
            err instanceof Error ? err.message : err,
          )
        },
      )
    }

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
