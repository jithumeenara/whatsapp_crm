import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

/**
 * GET /api/contacts/[id]/leads/history
 * Returns all leads for a contact with their FULL activity timelines.
 * Used by the ContactLeadHistoryModal on the lead detail page.
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
      select: { id: true, name: true, phone: true, email: true, avatar_url: true },
    })
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const leads = await prisma.lead.findMany({
      where: { contact_id: contactId, account_id: ctx.accountId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, title: true, status: true, score: true, source: true,
        notes: true, district: true, place: true,
        lost_reason: true, closing_remarks: true,
        created_at: true, converted_at: true, updated_at: true,
        assigned_to: true,
        assignee: {
          select: {
            id: true, email: true,
            profile: { select: { full_name: true, avatar_url: true } },
          },
        },
        activities: {
          orderBy: { created_at: 'asc' },
          take: 100,
          select: {
            id: true, type: true, title: true, description: true,
            metadata: true, created_at: true,
            user: { select: { profile: { select: { full_name: true } } } },
          },
        },
        _count: { select: { follow_ups: true, activities: true } },
      },
    })

    const total  = leads.length
    const active = leads.filter((l) => l.status !== 'closed').length
    const closed = leads.filter((l) => l.status === 'closed').length

    return NextResponse.json({ contact, leads, counts: { total, active, closed } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
