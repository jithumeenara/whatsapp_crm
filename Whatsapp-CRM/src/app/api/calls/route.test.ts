import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** ?day=today and ?filter=missed on the call list. */

const h = vi.hoisted(() => ({ zone: 'Asia/Kolkata', wheres: [] as Array<Record<string, unknown>> }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'agent' }) }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => h.zone }))
vi.mock('@/lib/db', () => ({
  prisma: {
    call: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        h.wheres.push(a.where)
        return []
      },
      count: async () => 0,
      groupBy: async () => [],
      aggregate: async () => ({ _sum: {}, _avg: {}, _count: { _all: 0 } }),
    },
  },
}))

import { GET } from './route'

const get = (qs: string) => GET(new Request(`http://x/api/calls?${qs}`))
const T = (iso: string) => new Date(iso)

describe('GET /api/calls ?day=today', () => {
  beforeEach(() => {
    h.wheres = []
    h.zone = 'Asia/Kolkata'
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('is the business day, cut at local midnight to the millisecond', async () => {
    vi.setSystemTime(T('2026-11-07T18:29:59.999Z')) // 23:59:59.999 on the 7th
    await get('day=today')
    expect(h.wheres[0].started_at).toEqual({ gte: T('2026-11-06T18:30:00.000Z'), lt: T('2026-11-07T18:30:00.000Z') })
    h.wheres = []
    vi.setSystemTime(T('2026-11-07T18:30:00.000Z')) // 00:00 on the 8th
    await get('day=today')
    expect(h.wheres[0].started_at).toEqual({ gte: T('2026-11-07T18:30:00.000Z'), lt: T('2026-11-08T18:30:00.000Z') })
  })

  it('is 25 hours long in New York on 1 Nov 2026', async () => {
    h.zone = 'America/New_York'
    vi.setSystemTime(T('2026-11-01T12:00:00.000Z'))
    await get('day=today')
    expect(h.wheres[0].started_at).toEqual({ gte: T('2026-11-01T04:00:00.000Z'), lt: T('2026-11-02T05:00:00.000Z') })
  })

  it('ignores any other day value and always scopes to the account', async () => {
    await get('day=yesterday')
    expect(h.wheres[0]).toEqual({ account_id: 'acc' })
  })

  it('missed means missed or declined, together with the day', async () => {
    vi.setSystemTime(T('2026-11-08T10:00:00.000Z'))
    await get('filter=missed&day=today')
    expect(h.wheres[0].account_id).toBe('acc')
    expect(h.wheres[0].status).toEqual({ in: ['missed', 'rejected'] })
    expect(h.wheres[0].started_at).toBeDefined()
  })
})
