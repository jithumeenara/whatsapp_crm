import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'

/**
 * Finding the same person entered twice.
 *
 * ── How they happen ─────────────────────────────────────────────────
 *
 * Creating a lead for a contact who already has one is caught and
 * offered as a choice, so the obvious route is covered. The ones that
 * get through arrive another way: an import, a Meta lead form, a
 * webhook from another system, a chatbot that saved a registration while
 * an agent was typing the same person in by hand. None of those pass
 * through the creation dialog, and none of them should be blocked — a
 * webhook that refuses a lead because one already exists loses the
 * lead.
 *
 * So they are found afterwards instead, which is also when somebody can
 * actually judge whether two rows are one person.
 *
 * ── What counts as a duplicate ──────────────────────────────────────
 *
 * Two or more open leads on the same contact. Not "the same phone
 * number": two contacts sharing a number is a contact-level duplicate
 * and merging leads would not fix it — it would hide it. Not closed
 * leads either, since the same customer enrolling twice in a year is
 * two genuine leads, and merging those would destroy the history of the
 * first.
 */

export async function GET(_req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const where: Record<string, unknown> = {
      account_id: ctx.accountId,
      status: { not: 'closed' },
      contact_id: { not: null },
    }
    // An agent sees duplicates among their own. A pair where one is
    // theirs and one is a colleague's is a supervisor's call, and
    // showing an agent a lead they cannot open would be worse than not
    // showing the pair at all.
    if (!canViewAllLeads(ctx.role)) where.assigned_to = ctx.userId

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        title: true,
        status: true,
        score: true,
        source: true,
        notes: true,
        created_at: true,
        updated_at: true,
        contact_id: true,
        contact: { select: { id: true, name: true, phone: true } },
        assignee: {
          select: { id: true, email: true, profile: { select: { full_name: true } } },
        },
        _count: { select: { activities: true, follow_ups: true, tasks: true } },
      },
    })

    const byContact = new Map<string, typeof leads>()
    for (const lead of leads) {
      if (!lead.contact_id) continue
      const bucket = byContact.get(lead.contact_id)
      if (bucket) bucket.push(lead)
      else byContact.set(lead.contact_id, [lead])
    }

    const groups = [...byContact.values()]
      .filter((g) => g.length > 1)
      // Worst first: five copies of one person is a bigger mess than
      // two, and is what somebody opening this page came to fix.
      .sort((a, b) => b.length - a.length)
      .map((g) => ({
        contact: g[0].contact,
        // Oldest first, so the suggested survivor is the original and
        // the later rows read as the accidents they usually are.
        leads: g,
      }))

    return NextResponse.json({ groups, total: groups.length })
  } catch (err) {
    console.error('[leads] duplicate scan failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not look for duplicates.' }, { status: 500 })
  }
}
