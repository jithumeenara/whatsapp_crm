import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/contacts/[id]/channels — the chats this contact has, one per
 * channel (the latest), for the contact panel's channel links. An agent
 * sees only the chats assigned to them, as in the Inbox.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    const contact = await prisma.contact.findFirst({ where: { id, account_id: ctx.accountId }, select: { id: true } })
    if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })

    const rows = await prisma.conversation.findMany({
      where: {
        account_id: ctx.accountId,
        contact_id: contact.id,
        ...(ctx.role === 'agent' ? { assigned_agent_id: ctx.userId } : {}),
      },
      orderBy: { last_message_at: 'desc' },
      distinct: ['channel'],
      select: { id: true, channel: true, last_message_at: true },
      take: 20,
    })
    return NextResponse.json({
      channels: rows.map((r) => ({ channel: r.channel ?? 'whatsapp', conversation_id: r.id, last_message_at: r.last_message_at })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
