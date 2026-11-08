import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { resolveDashboardScope } from '@/lib/dashboard/scope'
import { resolvePeriod } from '@/lib/reports/period'
import { loadMetaAdsPeriod, type MetaAdsPeriod } from '@/lib/meta-ads/ad-leads'

const LIMIT = { limit: 20, windowMs: 60_000 }
const PERIODS = ['today', 'week', 'month'] as const
type Period = (typeof PERIODS)[number]

/** Meta's spend moves slowly and each read is a call to Meta: keep it five minutes. */
const CACHE_MS = 5 * 60_000
const CACHE_MAX = 200
const cache = new Map<string, { at: number; value: MetaAdsPeriod }>()
export function clearDashboardAdsCache() { cache.clear() }

/**
 * GET /api/dashboard/ads?period=today|week|month
 *
 * Meta ad spend for the dashboard's period beside the leads that came from
 * ads in the same days. Money, so owners and admins only. Loaded apart from
 * the main dashboard so a slow answer from Meta never holds the page up.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/dashboard')
    const scope = await resolveDashboardScope(ctx)
    if (!scope.money) return NextResponse.json({ error: 'Only owners and admins see ad spend.' }, { status: 403 })
    const rl = checkRateLimit(`dashboard-ads:${ctx.userId}`, LIMIT)
    if (!rl.success) return rateLimitResponse(rl)

    const period = (req.nextUrl.searchParams.get('period') ?? 'month') as Period
    if (!PERIODS.includes(period)) return NextResponse.json({ error: 'Choose today, week or month.' }, { status: 400 })

    const key = `${ctx.accountId}|${period}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.value)

    const tz = await businessTimezone(ctx.accountId)
    const now = new Date()
    const p = resolvePeriod({ kind: period }, now, tz)
    if (!p) return NextResponse.json({ error: 'The period could not be worked out.' }, { status: 400 })
    const value = await loadMetaAdsPeriod({ accountId: ctx.accountId, since: p.firstDay, until: p.lastDay, start: p.from, end: p.to })

    cache.delete(key)
    cache.set(key, { at: Date.now(), value })
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return NextResponse.json(value)
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load ad spend right now.' }, { status: 500 })
    return res
  }
}
