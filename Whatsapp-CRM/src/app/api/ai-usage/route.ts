import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { usdToInr, usdToInrRate, rateNote } from '@/lib/ai/currency'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Everything the Usage tab renders, in one round trip: headline totals
 * for the window, the same totals for the window before it (so "vs
 * previous period" is a real comparison rather than a decorative
 * arrow), a daily series for the trend chart, a per-feature breakdown,
 * and the most recent calls.
 *
 * One request rather than five because these all describe the same
 * window — five endpoints would let the tiles and the chart disagree
 * with each other if a call landed between them.
 */

export const dynamic = 'force-dynamic'

const ALLOWED_DAYS = [7, 30, 90] as const

interface Totals {
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  cost_inr: number
  errors: number
}

function emptyTotals(): Totals {
  return { requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_inr: 0, errors: 0 }
}

export async function GET(req: Request) {
  let accountId: string
  try {
    // Usage is spend data. Same 'admin' floor as the rest of the AI
    // section's read paths, not the 'viewer' floor used for content.
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const url = new URL(req.url)
  const requestedDays = Number(url.searchParams.get('days') ?? '30')
  const days = (ALLOWED_DAYS as readonly number[]).includes(requestedDays) ? requestedDays : 30

  const now = new Date()
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const previousStart = new Date(now.getTime() - days * 2 * 24 * 60 * 60 * 1000)

  const [current, previous, byFeature, daily, recent] = await Promise.all([
    prisma.aiUsageEvent.aggregate({
      where: { account_id: accountId, created_at: { gte: windowStart } },
      _count: { _all: true },
      _sum: { input_tokens: true, output_tokens: true, total_tokens: true, cost_usd: true },
    }),
    prisma.aiUsageEvent.aggregate({
      where: { account_id: accountId, created_at: { gte: previousStart, lt: windowStart } },
      _count: { _all: true },
      _sum: { input_tokens: true, output_tokens: true, total_tokens: true, cost_usd: true },
    }),
    prisma.aiUsageEvent.groupBy({
      by: ['feature'],
      where: { account_id: accountId, created_at: { gte: windowStart } },
      _count: { _all: true },
      _sum: { total_tokens: true, cost_usd: true },
    }),
    // Grouped in SQL rather than in JS: pulling every event back just to
    // bucket it by day would mean shipping the whole window over the
    // wire for a chart with at most 90 points.
    prisma.$queryRaw<Array<{ day: Date; requests: bigint; input_tokens: bigint; output_tokens: bigint; cost_usd: Prisma.Decimal }>>(
      Prisma.sql`
        SELECT date_trunc('day', created_at) AS day,
               COUNT(*)                      AS requests,
               COALESCE(SUM(input_tokens), 0)  AS input_tokens,
               COALESCE(SUM(output_tokens), 0) AS output_tokens,
               COALESCE(SUM(cost_usd), 0)      AS cost_usd
        FROM ai_usage_events
        WHERE account_id = ${accountId}::uuid AND created_at >= ${windowStart}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ),
    prisma.aiUsageEvent.findMany({
      where: { account_id: accountId },
      orderBy: { created_at: 'desc' },
      // Ten was enough to prove the tab worked and not enough to answer
      // "what did we spend this on". The window above already bounds
      // this; the list should cover it.
      take: 200,
      select: {
        id: true, created_at: true, feature: true, model: true, input_tokens: true,
        output_tokens: true, cost_usd: true, status: true, error: true, latency_ms: true,
      },
    }),
  ])

  const [currentErrors, previousErrors] = await Promise.all([
    prisma.aiUsageEvent.count({ where: { account_id: accountId, created_at: { gte: windowStart }, status: 'error' } }),
    prisma.aiUsageEvent.count({
      where: { account_id: accountId, created_at: { gte: previousStart, lt: windowStart }, status: 'error' },
    }),
  ])

  const toTotals = (
    agg: typeof current,
    errors: number,
  ): Totals => ({
    requests: agg._count._all,
    input_tokens: agg._sum.input_tokens ?? 0,
    output_tokens: agg._sum.output_tokens ?? 0,
    total_tokens: agg._sum.total_tokens ?? 0,
    cost_usd: Number(agg._sum.cost_usd ?? 0),
    cost_inr: usdToInr(Number(agg._sum.cost_usd ?? 0)),
    errors,
  })

  return NextResponse.json({
    days,
    totals: current._count._all > 0 ? toTotals(current, currentErrors) : emptyTotals(),
    previous_totals: previous._count._all > 0 ? toTotals(previous, previousErrors) : emptyTotals(),
    by_feature: byFeature
      .map((f) => ({
        feature: f.feature,
        requests: f._count._all,
        total_tokens: f._sum.total_tokens ?? 0,
        cost_usd: Number(f._sum.cost_usd ?? 0),
        cost_inr: usdToInr(Number(f._sum.cost_usd ?? 0)),
      }))
      .sort((a, b) => b.requests - a.requests),
    // bigint from COUNT/SUM doesn't survive JSON.stringify — converted
    // here rather than letting the route throw on serialization.
    daily: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      requests: Number(d.requests),
      input_tokens: Number(d.input_tokens),
      output_tokens: Number(d.output_tokens),
      cost_usd: Number(d.cost_usd),
      cost_inr: usdToInr(Number(d.cost_usd)),
    })),
    recent: recent.map((r) => ({
      ...r,
      cost_usd: Number(r.cost_usd),
      cost_inr: usdToInr(Number(r.cost_usd)),
      created_at: r.created_at.toISOString(),
    })),
    // The rate is sent with the figures, not baked into them, so the tab
    // can say what it converted at instead of presenting a rupee number
    // as though Google had billed it.
    inr_rate: usdToInrRate(),
    inr_note: rateNote(),
  })
}
