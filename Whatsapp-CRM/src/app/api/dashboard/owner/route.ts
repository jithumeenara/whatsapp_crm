import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { resolveDashboardScope } from '@/lib/dashboard/scope'
import { getOwnerDashboard, type DashboardPeriod } from '@/lib/dashboard/owner'

/** Each load runs the whole report: plenty for a person switching periods. */
const LIMIT = { limit: 30, windowMs: 60_000 }

/**
 * GET /api/dashboard/owner?period=today|week|month (default month)
 *
 * What the viewer sees is decided here from their role and their "assigned
 * only" switch, never from the request.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/dashboard')
    const limit = checkRateLimit(`dashboard-owner:${ctx.userId}`, LIMIT)
    if (!limit.success) return rateLimitResponse(limit)

    const kind = req.nextUrl.searchParams.get('period') ?? 'month'
    if (kind !== 'today' && kind !== 'week' && kind !== 'month') {
      return NextResponse.json({ error: 'Choose today, this week or this month.' }, { status: 400 })
    }

    const [tz, scope] = await Promise.all([businessTimezone(ctx.accountId), resolveDashboardScope(ctx)])
    const data = await getOwnerDashboard({ accountId: ctx.accountId, viewerId: ctx.userId, scope, period: kind as DashboardPeriod, now: new Date(), tz })
    return NextResponse.json(data)
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load the dashboard right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
