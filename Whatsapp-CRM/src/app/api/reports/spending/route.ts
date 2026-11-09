import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { loadSpending } from '@/lib/reports/spending'

/** A load runs about twenty queries and may ask Meta for ad spend. */
const SPENDING_LIMIT = { limit: 30, windowMs: 60_000 }

/**
 * GET /api/reports/spending?period=today|week|month|custom&from=&to=
 *
 * What the business spent on WhatsApp messages, AI and Meta Ads, by
 * category, number, person, team and day. For the people who run the team:
 * supervisors and above, with the Reports page. An agent never sees what
 * the business spends or what a colleague's messages cost, so there is no
 * agent view and no parameter can ask for one: the account comes from the
 * signed-in session, never from the request.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/reports')
    const limit = checkRateLimit(`spending:${ctx.userId}`, SPENDING_LIMIT)
    if (!limit.success) return rateLimitResponse(limit)

    const q = req.nextUrl.searchParams
    const kind = q.get('period') ?? 'month'
    let input: PeriodInput
    if (kind === 'custom') input = { kind, from: q.get('from') ?? '', to: q.get('to') ?? '' }
    else if (kind === 'today' || kind === 'week' || kind === 'month') input = { kind }
    else return NextResponse.json({ error: 'Choose today, this week, this month or your own dates.' }, { status: 400 })

    const tz = await businessTimezone(ctx.accountId)
    const period = resolvePeriod(input, new Date(), tz)
    if (!period) return NextResponse.json({ error: 'Choose a start and end date in order, up to one year apart.' }, { status: 400 })

    const spending = await loadSpending({ accountId: ctx.accountId, period, tz })
    return NextResponse.json({
      period: {
        kind: period.kind, firstDay: period.firstDay, lastDay: period.lastDay, partial: period.partial,
        from: period.from.toISOString(), to: period.to.toISOString(), timeZone: tz,
      },
      ...spending,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
