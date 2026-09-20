import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Where leads are lost.
 *
 * ── Why this reads history and not status ───────────────────────────
 *
 * `status` is where a lead is now, and a funnel is about where it has
 * been. A lead that went new → visited → closed shows only "closed"
 * today, so counting current statuses would say nobody ever visited —
 * and the stage where people actually drop out would be invisible,
 * which is the one thing this is for.
 *
 * So the stages a lead reached are read from its activity history, and
 * the lead's own fields fill in what history cannot: claimed_at for the
 * claim, converted_at for the outcome. A lead with no history at all
 * still counts for the stage it is sitting in, so an account that
 * predates activity logging is undercounted rather than blank.
 *
 * ── Why the second half is about open leads ─────────────────────────
 *
 * A funnel says what already happened, which nobody can change. The
 * useful half is where open leads are piling up right now and how long
 * they have been there — that is a list of what to do this afternoon.
 * Reported as a median rather than a mean: one lead forgotten for six
 * months would drag an average past anything a person recognises.
 */

const ALLOWED_DAYS = [7, 30, 90, 365]

/** The path a lead is expected to take. Not every lead takes all of it,
 *  and the point of the report is which step loses the most. */
const STAGES = [
  { key: 'created', label: 'Created' },
  { key: 'claimed', label: 'Picked up' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'engaged', label: 'Visited or booked' },
  { key: 'closed', label: 'Closed' },
  { key: 'converted', label: 'Converted' },
] as const

/** Stages that count as "we spoke to them at all". */
const CONTACTED_STATUSES = new Set([
  // 'open' means somebody has spoken to them and the outcome is not
  // settled yet. That is contact, whatever it turns into.
  'open',
  'call_not_connected',
  'visited',
  'appointment_fixed',
  'follow_up',
  'closed',
])

/** Stages that count as real engagement, not just an attempt. */
const ENGAGED_STATUSES = new Set(['visited', 'appointment_fixed'])

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export async function GET(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    // Supervisor and up: this is a report about everybody's work, and
    // an agent's own conversion rate shown next to the team's invites a
    // comparison nobody asked this endpoint to make.
    ctx = await requireRole('supervisor')
  } catch (err) {
    return toErrorResponse(err)
  }

  const requested = Number(req.nextUrl.searchParams.get('days') ?? '30')
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  try {
    const leads = await prisma.lead.findMany({
      // Unconfirmed suggestions are not leads yet. Counting them as
      // created would make the funnel's top number grow every time the
      // assistant guessed, and the conversion rate fall.
      where: { account_id: ctx.accountId, created_at: { gte: since }, ai_suggested: false },
      select: {
        id: true,
        status: true,
        source: true,
        claimed_at: true,
        assigned_to: true,
        converted_at: true,
        lost_reason: true,
        created_at: true,
        updated_at: true,
      },
    })

    if (leads.length === 0) {
      return NextResponse.json({
        days,
        total: 0,
        stages: STAGES.map((s) => ({ ...s, count: 0, dropFromPrevious: 0 })),
        open: [],
        bySource: [],
        lostReasons: [],
      })
    }

    // Every stage each lead ever reached, from its own history. One
    // query for the whole window rather than one per lead.
    const history = await prisma.leadActivity.findMany({
      where: {
        account_id: ctx.accountId,
        lead_id: { in: leads.map((l) => l.id) },
        type: 'stage_change',
      },
      select: { lead_id: true, metadata: true },
    })

    const reachedByLead = new Map<string, Set<string>>()
    for (const row of history) {
      if (!row.lead_id) continue
      const status = (row.metadata as { new_status?: unknown } | null)?.new_status
      if (typeof status !== 'string') continue
      const set = reachedByLead.get(row.lead_id) ?? new Set<string>()
      set.add(status)
      reachedByLead.set(row.lead_id, set)
    }

    const counts: Record<string, number> = {
      created: leads.length,
      claimed: 0,
      contacted: 0,
      engaged: 0,
      closed: 0,
      converted: 0,
    }

    for (const lead of leads) {
      // History, plus where it is now — a lead with no logged history
      // still counts for the stage it is sitting in.
      const reached = new Set(reachedByLead.get(lead.id) ?? [])
      reached.add(lead.status)

      if (lead.claimed_at || lead.assigned_to) counts.claimed += 1
      if ([...reached].some((s) => CONTACTED_STATUSES.has(s))) counts.contacted += 1
      if ([...reached].some((s) => ENGAGED_STATUSES.has(s))) counts.engaged += 1
      if (reached.has('closed')) counts.closed += 1
      if (lead.converted_at) counts.converted += 1
    }

    const stages = STAGES.map((stage, i) => {
      const count = counts[stage.key] ?? 0
      const previous = i === 0 ? count : counts[STAGES[i - 1].key] ?? 0
      return {
        ...stage,
        count,
        // How many were lost at this step. The number people actually
        // want: not "60% reached here" but "we lost 40 people here".
        dropFromPrevious: Math.max(0, previous - count),
        percentOfCreated: leads.length > 0 ? Math.round((count / leads.length) * 100) : 0,
      }
    })

    // Where the still-open ones are sitting, and for how long.
    const openByStatus = new Map<string, number[]>()
    for (const lead of leads) {
      if (lead.status === 'closed') continue
      const ageDays = (Date.now() - new Date(lead.updated_at).getTime()) / 86_400_000
      const bucket = openByStatus.get(lead.status) ?? []
      bucket.push(ageDays)
      openByStatus.set(lead.status, bucket)
    }
    const open = [...openByStatus.entries()]
      .map(([status, ages]) => ({
        status,
        count: ages.length,
        medianDaysUntouched: Math.round(median(ages) * 10) / 10,
      }))
      .sort((a, b) => b.count - a.count)

    // Which sources are worth the effort. Volume without conversion is
    // the trap this answers.
    const bySourceMap = new Map<string, { total: number; converted: number }>()
    for (const lead of leads) {
      const key = lead.source || 'unknown'
      const row = bySourceMap.get(key) ?? { total: 0, converted: 0 }
      row.total += 1
      if (lead.converted_at) row.converted += 1
      bySourceMap.set(key, row)
    }
    const bySource = [...bySourceMap.entries()]
      .map(([source, r]) => ({
        source,
        ...r,
        rate: r.total > 0 ? Math.round((r.converted / r.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)

    const lostMap = new Map<string, number>()
    for (const lead of leads) {
      if (!lead.lost_reason?.trim()) continue
      const key = lead.lost_reason.trim()
      lostMap.set(key, (lostMap.get(key) ?? 0) + 1)
    }
    const lostReasons = [...lostMap.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    return NextResponse.json({ days, total: leads.length, stages, open, bySource, lostReasons })
  } catch (err) {
    console.error('[leads] funnel failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not build the funnel.' }, { status: 500 })
  }
}
