import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { loadContext, parseSpec, runReport, ReportError } from '@/lib/reports/engine'
import { insightsFor } from '@/lib/reports/insights'

/**
 * POST /api/reports/run   { spec }
 *
 * Runs one report sentence and returns its numbers plus the rule-written
 * insights. Read-only, 15-second database limit, rate-limited per person.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requirePageAccess('/reports', 'supervisor')
    const limited = checkRateLimit(`report-run:${ctx.userId}`, { limit: 60, windowMs: 60_000 })
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => null)) as { spec?: unknown } | null
    const spec = parseSpec(body?.spec)
    const rc = await loadContext(ctx.accountId)
    const result = await runReport(rc, spec)
    return NextResponse.json({ result, insights: insightsFor(result) })
  } catch (err) {
    if (err instanceof ReportError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
