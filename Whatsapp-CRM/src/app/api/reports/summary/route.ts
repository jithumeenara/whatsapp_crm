import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { buildSummary } from '@/lib/reports/summary'
import { actions, headline } from '@/lib/reports/headline'

/** Each load runs the whole report: plenty for a person switching periods. */
const REPORT_LIMIT = { limit: 30, windowMs: 60_000 }

const WORD: Record<string, string> = { today: 'today', week: 'this week', month: 'this month', custom: 'in these days' }

/**
 * GET /api/reports/summary?period=today|week|month|custom&from=&to=
 *
 * Supervisors and above see the team. An agent (or a viewer given the
 * page) gets the same report built from their own leads, calls and wins
 * only: the scope is decided here from the role, never from the request,
 * so no parameter can widen it.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/reports')
    const limit = checkRateLimit(`reports:${ctx.userId}`, REPORT_LIMIT)
    if (!limit.success) return rateLimitResponse(limit)

    const q = req.nextUrl.searchParams
    const kind = q.get('period') ?? 'week'
    let input: PeriodInput
    if (kind === 'custom') input = { kind, from: q.get('from') ?? '', to: q.get('to') ?? '' }
    else if (kind === 'today' || kind === 'week' || kind === 'month') input = { kind }
    else return NextResponse.json({ error: 'Choose today, this week, this month or your own dates.' }, { status: 400 })

    const tz = await businessTimezone(ctx.accountId)
    const now = new Date()
    const period = resolvePeriod(input, now, tz)
    if (!period) return NextResponse.json({ error: 'Choose a start and end date in order, up to one year apart.' }, { status: 400 })

    const team = hasMinRole(ctx.role, 'supervisor')
    const summary = await buildSummary({ accountId: ctx.accountId, userId: team ? null : ctx.userId, period, now, tz })

    return NextResponse.json({
      period: {
        kind: period.kind, firstDay: period.firstDay, lastDay: period.lastDay, partial: period.partial,
        from: period.from.toISOString(), to: period.to.toISOString(),
        prevFrom: period.prevFrom.toISOString(), prevTo: period.prevTo.toISOString(), timeZone: tz,
      },
      headline: headline(summary, WORD[period.kind]),
      actions: actions(summary),
      summary,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
