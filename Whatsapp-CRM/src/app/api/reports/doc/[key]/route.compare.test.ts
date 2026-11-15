import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * The Compare tab through the route: built in the report's own scope
 * (an agent's comparison is of their own work only), only on reports that
 * have the tab, and downloadable with its own file name.
 */

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  builds: [] as string[],
  compares: [] as Array<{ userId: string | null; reportKey: string; dim: string | null; items: string | null }>,
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  return {
    ForbiddenError,
    requireRole: () => Promise.resolve({ userId: 'me', accountId: 'acc-1', role: h.role }),
    assertPageAccess: () => {},
    toErrorResponse: (e: { message?: string; status?: number }) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}), audit: () => Promise.resolve() }))
vi.mock('@/lib/reports/doc/business', () => ({ loadDocBusiness: () => Promise.resolve({ business: { name: 'Biz', lines: [], taxId: null, logo: null, brandColor: null }, language: 'en' }) }))
vi.mock('@/lib/reports/doc/pdf', () => ({ docToPdf: () => Promise.resolve(Buffer.from('%PDF-1.7')) }))
vi.mock('@/lib/reports/doc/xlsx', () => ({ docToXlsx: () => Promise.resolve(Buffer.from('PK')) }))
vi.mock('@/lib/reports/doc/pptx', () => ({ docToPptx: () => Promise.resolve(Buffer.from('PK')) }))
const doc = (key: string) => ({ key, title: key, period: { kind: 'week', firstDay: '2026-11-09', lastDay: '2026-11-15', timeZone: 'Asia/Kolkata' }, scope: 'team', blocks: [], generatedAt: '' })
vi.mock('@/lib/reports/doc/compare', () => ({
  compareDoc: (c: { userId: string | null }, i: { reportKey: string; dim: string | null; items: string | null }) => {
    h.compares.push({ userId: c.userId, reportKey: i.reportKey, dim: i.dim, items: i.items })
    return Promise.resolve(doc(i.reportKey))
  },
}))
for (const [mod, fn, key] of [['all', 'allReport', 'all'], ['leads', 'leadReport', 'leads'], ['agents', 'agentReport', 'agents'], ['sales', 'salesReport', 'sales'], ['spending', 'spendingReport', 'spending'], ['ads', 'adReport', 'ads'], ['guide', 'guideReport', 'guide']] as const) {
  vi.doMock(`@/lib/reports/doc/reports/${mod}`, () => ({
    [fn]: () => { h.builds.push(key); return Promise.resolve(doc(key)) },
  }))
}

const call = async (key: string, qs = '') => {
  const { GET } = await import('./route')
  return GET(new NextRequest(`http://x/api/reports/doc/${key}?${qs}`), { params: Promise.resolve({ key }) })
}

beforeAll(async () => { await import('./route') }, 60_000)
beforeEach(() => { h.role = 'agent'; h.builds = []; h.compares = [] })

describe('Compare tab (?tab=compare)', () => {
  it("an agent's comparison is built on their own work, whatever they ask to compare", async () => {
    expect((await call('agents', 'tab=compare&cmp=agent&items=a,b')).status).toBe(200)
    expect(h.compares).toEqual([{ userId: 'me', reportKey: 'agents', dim: 'agent', items: 'a,b' }])
    expect(h.builds).toEqual([])
  })

  it('a supervisor compares across the team', async () => {
    h.role = 'supervisor'
    await call('leads', 'tab=compare&cmp=source&items=Facebook,Website')
    expect(h.compares).toEqual([{ userId: null, reportKey: 'leads', dim: 'source', items: 'Facebook,Website' }])
  })

  it('a report without a Compare tab ignores it and builds the report', async () => {
    h.role = 'supervisor'
    await call('all', 'tab=compare')
    expect(h.compares).toEqual([])
    expect(h.builds).toEqual(['all'])
  })

  it('the comparison downloads with its own name', async () => {
    h.role = 'supervisor'
    const res = await call('leads', 'tab=compare&format=xlsx&period=custom&from=2026-11-01&to=2026-11-07')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="leads-compare-2026-11-01-to-2026-11-07.xlsx"')
  })

  it('a money report stays closed to an agent on the Compare tab too', async () => {
    expect((await call('ads', 'tab=compare')).status).toBe(403)
    expect(h.compares).toEqual([])
  })
})
