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
  'open',
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
  /** Supervisors: share the selected leads out in turn across a team
   *  (empty team = every agent and supervisor). */
  spread?: { team_user_ids?: unknown }
  /** With an assignment: the customer's open chat goes to the same person. */
  also_assign_chat?: boolean
}

/** The customer's open chats follow their lead to its new owner. */
async function moveChats(accountId: string, contactIds: Array<{ contactId: string; userId: string }>, actorUserId: string, reason: string) {
  const { recordAssignment } = await import('@/lib/agents/assign')
  for (const { contactId, userId } of contactIds) {
    const chats = await prisma.conversation.findMany({
      where: { account_id: accountId, contact_id: contactId, status: { not: 'closed' }, // NOT { = x } would skip unassigned chats (NULL), the very ones to move.
        OR: [{ assigned_agent_id: null }, { assigned_agent_id: { not: userId } }] },
      select: { id: true, assigned_agent_id: true },
    })
    for (const chat of chats) {
      const moved = await prisma.conversation.updateMany({ where: { id: chat.id, assigned_agent_id: chat.assigned_agent_id }, data: { assigned_agent_id: userId } })
      if (moved.count > 0) {
        await recordAssignment({ accountId, recordType: 'conversation', recordId: chat.id, previousUserId: chat.assigned_agent_id, newUserId: userId, actorUserId, source: 'bulk', reason })
      }
    }
  }
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

  // ── Spread across a team, in turn ───────────────────────────────────
  if (body.spread !== undefined) {
    if (!canViewAllLeads(ctx.role)) {
      return NextResponse.json({ error: 'Only a supervisor can share leads out.' }, { status: 403 })
    }
    const team = Array.isArray(body.spread?.team_user_ids) ? body.spread.team_user_ids.filter((v): v is string => typeof v === 'string') : []
    const { findAgents } = await import('@/lib/flows/agent-routing')
    const { takeTurn } = await import('@/lib/agents/rotation')
    const { recordAssignment } = await import('@/lib/agents/assign')
    const all = await findAgents({ accountId: ctx.accountId })
    const pool = team.length ? all.filter((a) => team.includes(a.userId)) : all.filter((a) => a.role === 'agent' || a.role === 'supervisor')
    if (pool.length === 0) return NextResponse.json({ error: 'Nobody in that team can take leads.' }, { status: 400 })
    const leads = await prisma.lead.findMany({ where: { id: { in: ids }, account_id: ctx.accountId }, select: { id: true, contact_id: true, assigned_to: true }, orderBy: { created_at: 'asc' } })
    if (leads.length === 0) return NextResponse.json({ error: 'None of those leads were found.', updated: 0 }, { status: 404 })
    const given: Record<string, number> = {}
    const chats: Array<{ contactId: string; userId: string }> = []
    for (const lead of leads) {
      // A deliberate share-out by a person: presence and hours are not checked.
      const next = await takeTurn(ctx.accountId, 'bulk-spread', pool)
      if (!next) break
      const reason = `${next.fullName} — shared out in turn by a supervisor (${pool.length} in the team)`
      const r = await prisma.lead.updateMany({ where: { id: lead.id, account_id: ctx.accountId }, data: { assigned_to: next.userId, claimed_at: new Date() } })
      if (r.count === 0) continue
      given[next.fullName] = (given[next.fullName] ?? 0) + 1
      await prisma.leadActivity
        .create({ data: { lead_id: lead.id, account_id: ctx.accountId, user_id: ctx.userId, type: 'assigned', title: `Assigned to ${next.fullName}`, description: reason } })
        .catch(() => {})
      await recordAssignment({ accountId: ctx.accountId, recordType: 'lead', recordId: lead.id, previousUserId: lead.assigned_to, newUserId: next.userId, actorUserId: ctx.userId, source: 'bulk', method: 'round_robin', reason })
      if (body.also_assign_chat !== false && lead.contact_id) chats.push({ contactId: lead.contact_id, userId: next.userId })
    }
    await moveChats(ctx.accountId, chats, ctx.userId, 'with their lead — shared out in turn').catch((err) => console.error('[leads] spread chats failed:', err))
    const updated = Object.values(given).reduce((a, b) => a + b, 0)
    return NextResponse.json({ updated, skipped: ids.length - updated, given })
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
    // A score is a short label (hot/warm/cold or the account's own levels);
    // anything else was written as-is, or crashed into a bare 500.
    const score = typeof body.score === 'string' ? body.score.trim() : ''
    if (!score || score.length > 40) {
      return NextResponse.json({ error: 'Choose a score.' }, { status: 400 })
    }
    data.score = score
    action = `score to ${score}`
  } else {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  // Scoped in the update itself, not checked beforehand. A check-then-
  // update can be raced; this cannot touch a row it does not own.
  const where: Record<string, unknown> = { id: { in: ids }, account_id: ctx.accountId }
  if (!canViewAllLeads(ctx.role)) where.assigned_to = ctx.userId

  try {
    const touched = await prisma.lead.findMany({
      where,
      select: { id: true, contact_id: true, assigned_to: true },
    })
    if (touched.length === 0) {
      return NextResponse.json(
        { error: 'None of those leads are yours to change.', updated: 0 },
        { status: 403 },
      )
    }

    const result = await prisma.lead.updateMany({ where, data })

    // An assignment: recorded with who did it, and the chat follows when asked.
    if (body.assigned_to !== undefined && body.status === undefined) {
      const { recordAssignment } = await import('@/lib/agents/assign')
      const reason = body.assigned_to ? `assigned in bulk by a ${ctx.role === 'agent' ? 'teammate' : 'manager'}` : 'returned to the pool in bulk'
      for (const lead of touched) {
        await recordAssignment({ accountId: ctx.accountId, recordType: 'lead', recordId: lead.id, previousUserId: lead.assigned_to, newUserId: body.assigned_to ?? null, actorUserId: ctx.userId, source: 'bulk', method: 'specific', reason })
      }
      if (body.assigned_to && body.also_assign_chat) {
        await moveChats(ctx.accountId, touched.filter((l) => l.contact_id).map((l) => ({ contactId: l.contact_id as string, userId: body.assigned_to as string })), ctx.userId, 'with their lead — assigned in bulk')
          .catch((err) => console.error('[leads] bulk chats failed:', err))
      }
    }

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

    // ── Closing in bulk hands those chats back too ───────────────────
    //
    // Same rule as closing one lead on its own page: the claim took the
    // conversation, so the close gives it back and the assistant picks
    // up whoever writes next. Doing it here as well, because closing
    // ten finished enquiries from the list is the common way to close
    // anything, and a rule that only held on the detail page would be a
    // rule nobody could rely on.
    //
    // Each lead releases only its own owner's hold — a colleague who
    // has since taken the chat keeps it.
    if (body.status === 'closed') {
      const byOwner = new Map<string, string[]>()
      for (const lead of touched) {
        if (!lead.contact_id) continue
        const owner = lead.assigned_to ?? ctx.userId
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), lead.contact_id])
      }
      await Promise.all(
        [...byOwner.entries()].map(([owner, contactIds]) =>
          prisma.conversation.updateMany({
            where: {
              account_id: ctx.accountId,
              contact_id: { in: contactIds },
              assigned_agent_id: owner,
            },
            data: { assigned_agent_id: null },
          }),
        ),
      ).catch((err) =>
        // The leads did close. A chat that stayed assigned is worth a
        // log line, not a failed request.
        console.error(
          '[leads] bulk closed, but a conversation could not be released:',
          err instanceof Error ? err.message : err,
        ),
      )
    }

    return NextResponse.json({
      updated: result.count,
      skipped: ids.length - result.count,
    })
  } catch (err) {
    console.error('[leads] bulk update failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not apply that change.' }, { status: 500 })
  }
}
