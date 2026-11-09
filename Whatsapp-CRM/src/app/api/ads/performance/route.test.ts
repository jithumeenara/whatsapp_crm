import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** Who sees what: ad spend and revenue per ad are for owners and admins only. */

const h = vi.hoisted(() => ({ money: false, pageOk: true, calls: [] as Array<{ accountId: string }> }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'agent' }), assertPageAccess: () => {} }
})
vi.mock('@/lib/meta-ads/access', async () => {
  const { NextResponse } = await import('next/server')
  return { adsReadGate: () => (h.pageOk ? null : NextResponse.json({ error: 'no' }, { status: 403 })) }
})
vi.mock('@/lib/dashboard/scope', () => ({ resolveDashboardScope: async () => ({ money: h.money }) }))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/ads/performance', () => ({
  adPerformance: async (a: { accountId: string }) => { h.calls.push({ accountId: a.accountId }); return { ads: [], campaigns: [], totals: {}, findings: [] } },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/ads/performance?${qs}`))

beforeEach(() => { h.money = false; h.pageOk = true; h.calls = [] })

describe('GET /api/ads/performance', () => {
  it('someone without money access gets 403 and nothing is read', async () => {
    const res = await get('period=month')
    expect(res.status).toBe(403)
    expect(h.calls).toHaveLength(0)
  })

  it('without the Ads page, even an owner gets 403', async () => {
    h.money = true
    h.pageOk = false
    expect((await get('period=month')).status).toBe(403)
    expect(h.calls).toHaveLength(0)
  })

  it('an owner/admin gets their own account\'s results', async () => {
    h.money = true
    const res = await get('period=week&accountId=someone-else')
    expect(res.status).toBe(200)
    expect(h.calls).toEqual([{ accountId: 'acc' }])
  })

  it('a wrong period is a plain 400', async () => {
    h.money = true
    expect((await get('period=year')).status).toBe(400)
    expect((await get('period=custom&from=2026-11-09&to=2026-11-01')).status).toBe(400)
  })
})
