import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'
import { sendPushToUser } from '@/lib/push'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const body = await req.json().catch(() => null) as { agent_id?: string | null } | null

    const conversation = await prisma.conversation.findFirst({
      where: { id, account_id: ctx.accountId },
      include: { contact: { select: { name: true, phone: true } } },
    })
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const agentId = body?.agent_id ?? null
    if (agentId !== null && typeof agentId !== 'string') {
      return NextResponse.json({ error: 'agent_id must be a user id or null' }, { status: 400 })
    }

    // Validate agent belongs to same account
    if (agentId) {
      const profile = await prisma.profile.findFirst({
        where: { user_id: agentId, account_id: ctx.accountId },
      })
      if (!profile) return NextResponse.json({ error: 'Agent not found in this account' }, { status: 404 })
    }

    // An agent may take an unassigned chat, or give back their own.
    // Moving a chat between people — taking a colleague's, handing one
    // on — is a supervisor's decision; this route used to let any agent
    // do either.
    if (!hasMinRole(ctx.role, 'supervisor')) {
      const current = conversation.assigned_agent_id
      const taking = agentId === ctx.userId && (current === null || current === ctx.userId)
      const givingBack = agentId === null && current === ctx.userId
      if (!taking && !givingBack) {
        return NextResponse.json({ error: 'Only a supervisor can move a conversation between people' }, { status: 403 })
      }
      // Conditional on what was just read, so two agents taking the same
      // chat at once cannot both win.
      const moved = await prisma.conversation.updateMany({
        where: { id, account_id: ctx.accountId, assigned_agent_id: current },
        data: { assigned_agent_id: agentId },
      })
      if (moved.count === 0) {
        return NextResponse.json({ error: 'Somebody else took this conversation a moment ago' }, { status: 409 })
      }
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { assigned_agent_id: agentId },
      include: {
        assigned_agent: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, name: true, phone: true } },
      },
    })

    // Send push notification to newly assigned agent
    if (agentId && agentId !== ctx.userId) {
      const contactName = conversation.contact?.name ?? conversation.contact?.phone ?? 'Unknown'
      await sendPushToUser(agentId, {
        title: 'New Conversation Assigned',
        body: `You have been assigned a conversation with ${contactName}`,
        tag: `conversation-${id}`,
        data: { type: 'assignment', conversationId: id },
      })
    }

    return NextResponse.json({ conversation: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
