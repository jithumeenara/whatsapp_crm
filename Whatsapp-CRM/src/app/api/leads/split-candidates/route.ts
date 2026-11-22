import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

/**
 * GET /api/leads/split-candidates — phone numbers that already carry two or
 * more leads with no person (bookings made before "several people on one
 * number" existed, when a second patient's lead went onto the same
 * contact). The split screen lets a supervisor give each lead its person.
 *
 * Supervisor+ with Leads access; this workspace only; at most 50 numbers,
 * newest first. Read-only — the changes go through the people API and
 * PATCH /api/leads/[id], which check everything again.
 */

const MAX_NUMBERS = 50

export async function GET() {
  try {
    const ctx = await requirePageAccess('/leads', 'supervisor')
    const groups = await prisma.lead.groupBy({
      by: ['contact_id'],
      where: { account_id: ctx.accountId, person_id: null, contact_id: { not: null } },
      _count: { _all: true },
      _max: { created_at: true },
      having: { contact_id: { _count: { gte: 2 } } },
      orderBy: { _max: { created_at: 'desc' } },
      take: MAX_NUMBERS,
    })
    const contactIds = groups.map((g) => g.contact_id).filter((id): id is string => typeof id === 'string')
    if (contactIds.length === 0) return NextResponse.json({ numbers: [] })

    const [contacts, leads, people] = await Promise.all([
      prisma.contact.findMany({ where: { account_id: ctx.accountId, id: { in: contactIds } }, select: { id: true, name: true, phone: true } }),
      prisma.lead.findMany({
        where: { account_id: ctx.accountId, contact_id: { in: contactIds }, person_id: null },
        orderBy: { created_at: 'asc' },
        select: { id: true, contact_id: true, title: true, status: true, created_at: true },
      }),
      prisma.contactPerson.findMany({
        where: { account_id: ctx.accountId, contact_id: { in: contactIds } },
        orderBy: { created_at: 'asc' },
        select: { id: true, contact_id: true, name: true, relation: true },
      }),
    ])
    const byId = new Map(contacts.map((c) => [c.id, c]))
    return NextResponse.json({
      numbers: contactIds.filter((id) => byId.has(id)).map((id) => ({
        contact: byId.get(id),
        leads: leads.filter((l) => l.contact_id === id).map((l) => ({ id: l.id, title: l.title, status: l.status, created_at: l.created_at })),
        people: people.filter((p) => p.contact_id === id).map((p) => ({ id: p.id, name: p.name, relation: p.relation })),
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
