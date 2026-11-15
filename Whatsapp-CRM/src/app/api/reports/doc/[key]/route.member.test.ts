import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * One person's Agent report card (?member=<id>): only supervisors and
 * above may open someone else's, only for a member of their own
 * business, and an agent asking for another person's card gets their own.
 */

const ME = '11111111-1111-4111-8111-111111111111'
const TEAMMATE = '22222222-2222-4222-8222-222222222222'
const OUTSIDER = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  builds: [] as Array<{ key: string; userId: string | null; subject: unknown }>,
  lookups: [] as Array<{ accountId: string; userId: string }>,
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  return {
    ForbiddenError,
    requireRole: () => Promise.resolve({ userId: ME, accountId: 'acc-1', role: h.role }),
    assertPageAccess: () => {},
    toErrorResponse: (e: { message?: string; status?: number }) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}), audit: () => Promise.resolve() }))
vi.mock('@/lib/reports/doc/member', () => ({
  findMember: (accountId: string, userId: string) => {
    h.lookups.push({ accountId, userId })
    return Promise.resolve(accountId === 'acc-1' && userId === TEAMMATE ? { userId, name: 'Asha' } : null)
  },
}))
const doc = (key: string) => ({ key, title: key, period: { kind: 'week', firstDay: '2026-11-09', lastDay: '2026-11-15', timeZone: 'Asia/Kolkata' }, scope: 'team', blocks: [], generatedAt: '' })
for (const [mod, fn, key] of [['all', 'allReport', 'all'], ['leads', 'leadReport', 'leads'], ['agents', 'agentReport', 'agents'], ['sales', 'salesReport', 'sales'], ['spending', 'spendingReport', 'spending'], ['ads', 'adReport', 'ads']] as const) {
  vi.doMock(`@/lib/reports/doc/reports/${mod}`, () => ({
    [fn]: (c: { userId: string | null; subject?: unknown }) => { h.builds.push({ key, userId: c.userId, subject: c.subject ?? null }); return Promise.resolve(doc(key)) },
  }))
}

const call = async (key: string, qs = '') => {
  const { GET } = await import('./route')
  return GET(new NextRequest(`http://x/api/reports/doc/${key}?${qs}`), { params: Promise.resolve({ key }) })
}

// The route pulls in every report builder; load it once, outside the
// first test's time limit, so a slow cold import cannot fail that test.
beforeAll(async () => { await import('./route') }, 60_000)
beforeEach(() => { h.role = 'agent'; h.builds = []; h.lookups = [] })

describe('Agent report card (?member=)', () => {
  it("an agent asking for a teammate's card gets their own, and nobody is looked up", async () => {
    const res = await call('agents', `member=${TEAMMATE}`)
    expect(res.status).toBe(200)
    expect(h.builds).toEqual([{ key: 'agents', userId: ME, subject: { userId: ME, name: null, self: true } }])
    expect(h.lookups).toEqual([])
  })

  it("a supervisor opens a teammate's card: built for that person only", async () => {
    h.role = 'supervisor'
    expect((await call('agents', `member=${TEAMMATE}`)).status).toBe(200)
    expect(h.builds).toEqual([{ key: 'agents', userId: TEAMMATE, subject: { userId: TEAMMATE, name: 'Asha', self: false } }])
    expect(h.lookups).toEqual([{ accountId: 'acc-1', userId: TEAMMATE }])
  })

  it('someone from another business, or a made-up id, is 404 and nothing is built', async () => {
    h.role = 'owner'
    expect((await call('agents', `member=${OUTSIDER}`)).status).toBe(404)
    expect((await call('agents', 'member=not-a-uuid')).status).toBe(400)
    expect(h.builds).toEqual([])
  })

  it('member is ignored on other reports: a supervisor still gets the team there', async () => {
    h.role = 'supervisor'
    expect((await call('leads', `member=${TEAMMATE}`)).status).toBe(200)
    expect(h.builds).toEqual([{ key: 'leads', userId: null, subject: null }])
    expect(h.lookups).toEqual([])
  })

  it('without member a supervisor gets the team view', async () => {
    h.role = 'supervisor'
    await call('agents')
    expect(h.builds).toEqual([{ key: 'agents', userId: null, subject: null }])
  })
})
