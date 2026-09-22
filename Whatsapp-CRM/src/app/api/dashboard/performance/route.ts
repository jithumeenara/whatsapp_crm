import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'
import { summarise, type StageChange, type Performance } from '@/lib/leads/performance'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * GET /api/dashboard/performance?days=7
 *
 * What this person did — or, for somebody who can see the whole
 * account, what everybody did.
 *
 * ── Why an agent's own numbers are not optional ─────────────────────
 *
 * An agent sees only their own row and cannot ask for anybody else's.
 * Not because the figures are secret — a supervisor will discuss them
 * openly — but because a screen that lets one agent look up another's
 * conversion rate turns a working tool into a scoreboard, and the first
 * thing a scoreboard changes is which leads people pick.
 *
 * ── Why the window is a parameter ───────────────────────────────────
 *
 * A day is too short to mean anything — one closed lead swings the
 * conversion rate by fifty points — and a quarter is too long to act
 * on. Seven days is the default because it contains a full week of
 * whatever this business's rhythm is.
 */

/** A sensible week, and a ceiling so one request cannot read a year. */
const DEFAULT_DAYS = 7
const MAX_DAYS = 90

interface Row extends Performance {
  user_id: string
  full_name: string
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')

    const asked = Number(req.nextUrl.searchParams.get('days'))
    const days = Number.isFinite(asked) && asked > 0
      ? Math.min(Math.floor(asked), MAX_DAYS)
      : DEFAULT_DAYS
    const since = new Date(Date.now() - days * 24 * 60 * 60_000)

    // A supervisor or above gets everybody; an agent gets themselves,
    // whatever they ask for.
    const canSeeTeam = canViewAllLeads(ctx.role)

    const people = canSeeTeam
      ? await prisma.profile.findMany({
          where: { account_id: ctx.accountId },
          select: { user_id: true, full_name: true, account_role: true },
          orderBy: { full_name: 'asc' },
        })
      : [{ user_id: ctx.userId, full_name: '', account_role: ctx.role }]

    const userIds = people.map((p) => p.user_id)

    const [picked, stageChanges, won, lost] = await Promise.all([
      // Taken off the pool. claimed_at is the moment somebody put their
      // name on it, which is the question — not created_at, which is
      // when the customer wrote in.
      prisma.lead.groupBy({
        by: ['assigned_to'],
        where: {
          account_id: ctx.accountId,
          assigned_to: { in: userIds },
          claimed_at: { gte: since },
        },
        _count: { _all: true },
      }),

      // Every recorded call outcome. See lib/leads/performance.ts for
      // why these are stage changes rather than rows of type 'call'.
      prisma.leadActivity.findMany({
        where: {
          account_id: ctx.accountId,
          user_id: { in: userIds },
          type: 'stage_change',
          created_at: { gte: since },
        },
        select: { user_id: true, lead_id: true, metadata: true },
      }),

      // Converted. converted_at is a real timestamp, so the window is
      // exact.
      prisma.lead.groupBy({
        by: ['assigned_to'],
        where: {
          account_id: ctx.accountId,
          assigned_to: { in: userIds },
          converted_at: { gte: since },
        },
        _count: { _all: true },
      }),

      // Closed without converting. lost_at is a real timestamp — the
      // mirror of converted_at — so the window is exact on both sides
      // of the conversion rate. It used to lean on updated_at, which
      // moves whenever anything on the row is touched, and made a lead
      // lost in March count as this week's loss if somebody opened it.
      prisma.lead.groupBy({
        by: ['assigned_to'],
        where: {
          account_id: ctx.accountId,
          assigned_to: { in: userIds },
          lost_at: { gte: since },
        },
        _count: { _all: true },
      }),
    ])

    const countBy = (rows: Array<{ assigned_to: string | null; _count: { _all: number } }>) =>
      new Map(rows.map((r) => [r.assigned_to ?? '', r._count._all]))

    const pickedBy = countBy(picked)
    const wonBy = countBy(won)
    const lostBy = countBy(lost)

    const changesBy = new Map<string, StageChange[]>()
    for (const a of stageChanges) {
      if (!a.user_id) continue
      const meta = (a.metadata ?? {}) as Record<string, unknown>
      const list = changesBy.get(a.user_id) ?? []
      list.push({
        newStatus: typeof meta.new_status === 'string' ? meta.new_status : null,
        leadId: a.lead_id,
      })
      changesBy.set(a.user_id, list)
    }

    const rows: Row[] = people.map((p) => ({
      user_id: p.user_id,
      full_name: p.full_name,
      ...summarise({
        picked: pickedBy.get(p.user_id) ?? 0,
        stageChanges: changesBy.get(p.user_id) ?? [],
        won: wonBy.get(p.user_id) ?? 0,
        lost: lostBy.get(p.user_id) ?? 0,
      }),
    }))

    return NextResponse.json({
      days,
      since,
      // Always present: an agent's own row, and a supervisor's own row
      // among the team's. Whoever is looking, this is them.
      me: rows.find((r) => r.user_id === ctx.userId) ?? null,
      team: canSeeTeam ? rows : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
