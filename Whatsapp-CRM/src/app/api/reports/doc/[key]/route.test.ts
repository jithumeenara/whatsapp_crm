import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/reports/doc/[key]: who sees what, end to end through the route.
 * An agent gets only their own numbers and never a file or a money report;
 * a supervisor gets the team; nothing in the request can widen either.
 */

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  pageOk: true,
  builds: [] as Array<{ key: string; userId: string | null; canSeeMoney: boolean }>,
  audits: [] as Array<Record<string, unknown>>,
  files: [] as string[],
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  return {
    ForbiddenError,
    requireRole: () => Promise.resolve({ userId: 'me', accountId: 'acc-1', role: h.role }),
    assertPageAccess: () => { if (!h.pageOk) throw new ForbiddenError('No access to this section') },
    toErrorResponse: (e: { message?: string; status?: number }) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}), audit: (_c: unknown, e: Record<string, unknown>) => { h.audits.push(e); return Promise.resolve() } }))
vi.mock('@/lib/reports/doc/business', () => ({ loadDocBusiness: () => Promise.resolve({ business: { name: 'Biz', lines: [], taxId: null, logo: null, brandColor: null }, language: 'en' }) }))
const doc = (key: string, userId: string | null) => ({ key, title: key, period: { kind: 'week', firstDay: '2026-11-09', lastDay: '2026-11-15', timeZone: 'Asia/Kolkata' }, scope: userId ? 'self' : 'team', blocks: [{ kind: 'kpis', id: 'k', items: [{ label: 'Revenue', value: '₹1,20,000' }] }], generatedAt: '' })
for (const [mod, fn, key] of [['all', 'allReport', 'all'], ['leads', 'leadReport', 'leads'], ['agents', 'agentReport', 'agents'], ['sales', 'salesReport', 'sales'], ['spending', 'spendingReport', 'spending'], ['ads', 'adReport', 'ads']] as const) {
  vi.doMock(`@/lib/reports/doc/reports/${mod}`, () => ({
    [fn]: (c: { userId: string | null }, money?: boolean) => { h.builds.push({ key, userId: c.userId, canSeeMoney: Boolean(money) }); return Promise.resolve(doc(key, c.userId)) },
  }))
}
vi.mock('@/lib/reports/doc/pdf', () => ({ docToPdf: () => { h.files.push('pdf'); return Promise.resolve(Buffer.from('%PDF-1.7')) } }))
vi.mock('@/lib/reports/doc/xlsx', () => ({ docToXlsx: () => { h.files.push('xlsx'); return Promise.resolve(Buffer.from('PK')) } }))
vi.mock('@/lib/reports/doc/pptx', () => ({ docToPptx: () => { h.files.push('pptx'); return Promise.resolve(Buffer.from('PK')) } }))

const call = async (key: string, qs = '') => {
  const { GET } = await import('./route')
  return GET(new NextRequest(`http://x/api/reports/doc/${key}?${qs}`), { params: Promise.resolve({ key }) })
}

beforeEach(() => { h.role = 'agent'; h.pageOk = true; h.builds = []; h.audits = []; h.files = [] })

describe('GET /api/reports/doc/[key]', () => {
  it('an agent gets their own numbers, whatever the request asks for', async () => {
    const res = await call('leads', 'userId=someone-else&scope=team')
    expect(res.status).toBe(200)
    expect(h.builds).toEqual([{ key: 'leads', userId: 'me', canSeeMoney: false }])
  })

  it('an agent never gets a file, and never a money report', async () => {
    expect((await call('leads', 'format=pdf')).status).toBe(403)
    expect((await call('ads')).status).toBe(403)
    expect((await call('spending')).status).toBe(403)
    expect(h.files).toEqual([])
    expect(h.builds).toEqual([])
  })

  it('a supervisor gets the team, and all three files, each audited without figures', async () => {
    h.role = 'supervisor'
    expect((await call('leads')).status).toBe(200)
    expect(h.builds[0]).toMatchObject({ userId: null })
    for (const f of ['pdf', 'xlsx', 'pptx']) {
      const res = await call('leads', `format=${f}&period=custom&from=2026-11-01&to=2026-11-07`)
      expect(res.status, f).toBe(200)
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="leads-report-2026-11-01-to-2026-11-07.${f}"`)
    }
    expect(h.files).toEqual(['pdf', 'xlsx', 'pptx'])
    expect(h.audits).toHaveLength(3)
    expect(JSON.stringify(h.audits)).not.toContain('1,20,000')
  })

  it('a supervisor is refused the ad report (owners and admins only); an admin gets it with money', async () => {
    h.role = 'supervisor'
    expect((await call('ads')).status).toBe(403)
    h.role = 'admin'
    expect((await call('ads')).status).toBe(200)
    // The route itself gates the ad report to owners/admins; it is built for the whole team.
    expect(h.builds.at(-1)).toMatchObject({ key: 'ads', userId: null })
  })

  it('without the Reports page nothing is built; unknown report 404; bad dates or format 400', async () => {
    h.role = 'admin'
    h.pageOk = false
    expect((await call('leads')).status).toBe(403)
    h.pageOk = true
    expect((await call('nope')).status).toBe(404)
    expect((await call('leads', 'period=custom&from=2026-11-09&to=2026-11-01')).status).toBe(400)
    expect((await call('leads', 'format=docx')).status).toBe(400)
    expect(h.builds).toEqual([])
  })
})
