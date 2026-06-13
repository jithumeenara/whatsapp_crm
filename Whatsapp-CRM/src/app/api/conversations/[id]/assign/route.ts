import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
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

    // Validate agent belongs to same account
    if (agentId) {
      const profile = await prisma.profile.findFirst({
        where: { user_id: agentId, account_id: ctx.accountId },
      })
      if (!profile) return NextResponse.json({ error: 'Agent not found in this account' }, { status: 404 })
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
