import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (rule 10, times keep their zone): the AI Usage tab's month filter and
 * its daily chart cut days and months by the SERVER's clock and the
 * database's zone, so a call made at 11 pm in Kolkata on 30 November counted
 * in December, and the Spending report and this tab disagreed about the same
 * month. They must cut by the business's own zone.
 *
 * It also had no rate limit, and each load runs eight queries.
 */

const h = vi.hoisted(() => ({
  recentWhere: null as any,
  rawSql: [] as string[],
  userId: 'u1',
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: h.userId, accountId: 'acc-1', role: 'admin' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/ai/currency', () => ({
  usdToInr: (n: number) => n,
  usdToInrRate: () => 88.5,
  rateNote: () => '',
}))

const agg = { _count: { _all: 0 }, _sum: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 } }
vi.mock('@/lib/db', () => ({
  prisma: {
    aiUsageEvent: {
      aggregate: () => Promise.resolve(agg),
      groupBy: () => Promise.resolve([]),
      count: () => Promise.resolve(0),
      findMany: ({ where }: any) => {
        h.recentWhere = where
        return Promise.resolve([])
      },
    },
    $queryRaw: (sql: { strings?: string[]; sql?: string; text?: string }) => {
      h.rawSql.push(String(sql.sql ?? sql.text ?? (sql.strings ?? []).join('?')))
      return Promise.resolve([])
    },
  },
}))

import { GET } from './route'

beforeEach(() => {
  // The server is not in the business's zone (the VPS runs UTC); this machine
  // may be, which would hide the bug.
  process.env.TZ = 'UTC'
  h.recentWhere = null
  h.rawSql = []
  h.userId = `u-${Math.random()}`
})

const get = (qs = '') => GET(new Request(`http://x/api/ai-usage${qs}`))

describe('GET /api/ai-usage', () => {
  it('cuts the chosen month at midnight in the business zone, not the server\'s', async () => {
    await get('?month=2026-11')
    const { gte, lt } = h.recentWhere.created_at
    expect(new Date(gte).toISOString()).toBe('2026-10-31T18:30:00.000Z') // 1 Nov 00:00 in Kolkata
    expect(new Date(lt).toISOString()).toBe('2026-11-30T18:30:00.000Z') // 1 Dec 00:00 in Kolkata
  })

  it('buckets days and months in the business zone in SQL', async () => {
    await get()
    const sql = h.rawSql.join('\n')
    expect(sql).toMatch(/AT TIME ZONE/i)
  })

  it('turns away the sixty-first load in a minute from one person', async () => {
    let last = 200
    for (let i = 0; i < 61; i++) last = (await get()).status
    expect(last).toBe(429)
  })
})
