import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { adsReadGate } from '@/lib/meta-ads/access'
import { businessTimezone } from '@/lib/ai/human-date'
import { resolveDashboardScope } from '@/lib/dashboard/scope'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { adPerformance } from '@/lib/ads/performance'

/**
 * GET /api/ads/performance?period=today|week|month|custom&from=&to=
 *
 * Every ad from click to cash (src/lib/ads/performance.ts). Spend and
 * revenue are team money: owners and admins only, and the Ads page must
 * be allowed for the person (adsReadGate, which also rate-limits: a load
 * may call Meta, cached 5 minutes per account and days).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    const denied = adsReadGate(ctx, 'performance')
    if (denied) return denied
    const scope = await resolveDashboardScope(ctx)
    if (!scope.money) return NextResponse.json({ error: 'Only owners and admins see ad results.' }, { status: 403 })

    const q = req.nextUrl.searchParams
    const kind = q.get('period') ?? 'month'
    let input: PeriodInput
    if (kind === 'custom') input = { kind, from: q.get('from') ?? '', to: q.get('to') ?? '' }
    else if (kind === 'today' || kind === 'week' || kind === 'month') input = { kind }
    else return NextResponse.json({ error: 'Choose today, this week, this month or your own dates.' }, { status: 400 })

    const tz = await businessTimezone(ctx.accountId)
    const period = resolvePeriod(input, new Date(), tz)
    if (!period) return NextResponse.json({ error: 'Choose a start and end date in order, up to one year apart.' }, { status: 400 })

    const result = await adPerformance({ accountId: ctx.accountId, from: period.from, to: period.to, firstDay: period.firstDay, lastDay: period.lastDay })
    return NextResponse.json({ period: { kind: period.kind, firstDay: period.firstDay, lastDay: period.lastDay, timeZone: tz }, ...result })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load ad results right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
