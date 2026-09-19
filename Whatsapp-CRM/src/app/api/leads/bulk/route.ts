import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'

/**
 * One change, applied to many leads.
 *
 * ── Why this is not a loop in the browser ───────────────────────────
 *
 * It could be: fifty PATCHes from the page would work. They would also
 * be fifty round trips, fifty chances to fail halfway, and fifty
 * activity rows written one at a time while somebody watches a spinner.
 * Worse, a half-applied bulk change is invisible — the list reloads and
 * some rows moved, and nobody can tell which ones did not.
 *
 * So the whole set is checked first, changed in one statement, and the
 * response says exactly how many were touched. Either the change applied
 * to everything the caller was allowed to touch, or it applied to
 * nothing and said why.
 *
 * ── What an agent may do ────────────────────────────────────────────
 *
 * Only to their own leads. The filter is part of the update rather than
 * a check before it: a check-then-update can be raced, and an update
 * scoped by `assigned_to` simply cannot touch a row it does not own, no
 * matter what ids the request carried.
 */

/** A bulk action is a convenience, not a migration tool. Past this the
 *  right answer is a filter, not a longer list of ids. */
const MAX_IDS = 200

const STATUSES = new Set([
  'new',
  'call_not_connected',
  'visited',
  'appointment_fixed',
  'follow_up',
  'closed',
])

interface BulkBody {
  ids?: unknown
  /** Exactly one of these. Two at once is ambiguous about ordering and
   *  about what the activity log should say. */
  status?: string
  /** A user id, or null to return leads to the pool. */
  assigned_to?: string | null
  score?: string
}

export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await req.json().catch(() => null)) as BulkBody | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((i): i is string => typeof i === 'string' && i.length > 0))]
    : []
  if (ids.length === 0) return NextResponse.json({ error: 'No leads selected.' }, { status: 400 })
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `That is more than ${MAX_IDS} leads. Narrow the list with a filter first.` },
      { status: 400 },
    )
  }

  const data: Record<string, unknown> = {}
  let action = ''

  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: `Unknown status "${body.status}".` }, { status: 400 })
    }
    data.status = body.status
    action = `status to ${body.status.replace(/_/g, ' ')}`
  } else if (body.assigned_to !== undefined) {
    // Reassigning somebody else's work is a supervisor's job. An agent
    // may claim and may hand back, not hand around.
    if (!canViewAllLeads(ctx.role) && body.assigned_to !== ctx.userId && body.assigned_to !== null) {
      return NextResponse.json(
        { error: 'Only a supervisor can assign leads to someone else.' },
        { status: 403 },
      )
    }
    if (body.assigned_to) {
      // A real member of this account, checked rather than trusted — the
      // id came from a request body.
      const member = await prisma.profile.findFirst({
        where: { user_id: body.assigned_to, account_id: ctx.accountId },
        select: { user_id: true },
      })
      if (!member) return NextResponse.json({ error: 'That person is not on this account.' }, { status: 400 })
    }
    data.assigned_to = body.assigned_to
    data.claimed_at = body.assigned_to ? new Date() : null
    action = body.assigned_to ? 'assigned' : 'returned to the pool'
  } else if (body.score !== undefined) {
    data.score = body.score
    action = `score to ${body.score}`
  } else {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  // Scoped in the update itself, not checked beforehand. A check-then-
  // update can be raced; this cannot touch a row it does not own.
  const where: Record<string, unknown> = { id: { in: ids }, account_id: ctx.accountId }
  if (!canViewAllLeads(ctx.role)) where.assigned_to = ctx.userId

  try {
    const touched = await prisma.lead.findMany({ where, select: { id: true } })
    if (touched.length === 0) {
      return NextResponse.json(
        { error: 'None of those leads are yours to change.', updated: 0 },
        { status: 403 },
      )
    }

    const result = await prisma.lead.updateMany({ where, data })

    // One activity row per lead, in one insert. The timeline is what
    // somebody reads to understand a lead's history, and a change that
    // left no trace there would be a change nobody could account for.
    await prisma.leadActivity
      .createMany({
        data: touched.map((l) => ({
          lead_id: l.id,
          account_id: ctx.accountId,
          user_id: ctx.userId,
          type: 'stage_change',
          title: `Bulk: ${action}`,
          description: `Changed as one of ${touched.length} leads.`,
          metadata: data as object,
        })),
      })
      .catch((err) =>
        // The leads did change. A missing timeline entry is worth a log
        // line, not an error the caller has to interpret.
        console.error('[leads] bulk activity log failed:', err instanceof Error ? err.message : err),
      )

    return NextResponse.json({
      updated: result.count,
      skipped: ids.length - result.count,
    })
  } catch (err) {
    console.error('[leads] bulk update failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not apply that change.' }, { status: 500 })
  }
}
