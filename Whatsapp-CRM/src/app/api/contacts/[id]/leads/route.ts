import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

/**
 * GET /api/contacts/[id]/leads
 * Returns all leads for a contact with aggregate counts.
 * Used by: duplicate detection dialog, contact profile leads tab.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')
    const { id: contactId } = await params

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, account_id: ctx.accountId },
      select: {
        id: true, name: true, phone: true, email: true, avatar_url: true, created_at: true,
      },
    })
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const leads = await prisma.lead.findMany({
      where: { contact_id: contactId, account_id: ctx.accountId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, title: true, status: true, score: true, source: true,
        notes: true, created_at: true, converted_at: true,
        assigned_to: true,
        assignee: {
          select: {
            id: true, email: true,
            profile: { select: { full_name: true, avatar_url: true } },
          },
        },
        activities: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { created_at: true, title: true, type: true },
        },
        _count: { select: { follow_ups: true, activities: true } },
      },
    })

    const total  = leads.length
    const active = leads.filter((l) => l.status !== 'closed').length
    const closed = leads.filter((l) => l.status === 'closed').length
    const lastActivity = leads
      .flatMap((l) => l.activities)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]

    return NextResponse.json({
      contact,
      leads,
      counts: { total, active, closed },
      lastActivityAt: lastActivity?.created_at ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
