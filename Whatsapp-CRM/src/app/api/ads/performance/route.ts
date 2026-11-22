import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { adsReadGate } from '@/lib/meta-ads/access'
import { businessTimezone } from '@/lib/ai/human-date'
import { resolveDashboardScope } from '@/lib/dashboard/scope'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { adPerformance } from '@/lib/ads/performance'
import { prisma } from '@/lib/db'

/**
 * GET /api/ads/performance?period=today|week|month|custom&from=&to=&account=
 * (`account`: one connected ad account's id; all of them when absent)
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

    const account = q.get('account')
    if (account !== null && account !== '' && !/^\d{1,30}$/.test(account)) return NextResponse.json({ error: 'Choose one of your ad accounts.' }, { status: 400 })
    // Only this workspace's own ad accounts can be chosen.
    const adAccounts = await prisma.metaAdAccount.findMany({ where: { account_id: ctx.accountId }, select: { ad_account_id: true, name: true, currency: true, is_default: true }, orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }], take: 50 }).catch(() => [])
    const chosen = account && adAccounts.some((a) => a.ad_account_id === account) ? account : undefined
    if (account && !chosen) return NextResponse.json({ error: 'Choose one of your ad accounts.' }, { status: 400 })

    const result = await adPerformance({ accountId: ctx.accountId, from: period.from, to: period.to, firstDay: period.firstDay, lastDay: period.lastDay, ...(chosen ? { adAccountId: chosen } : {}) })
    return NextResponse.json({
      period: { kind: period.kind, firstDay: period.firstDay, lastDay: period.lastDay, timeZone: tz },
      adAccounts: adAccounts.map((a) => ({ id: a.ad_account_id, name: a.name, currency: a.currency })),
      account: chosen ?? null,
      ...result,
    })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load ad results right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
