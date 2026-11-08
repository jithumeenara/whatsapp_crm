import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  role: 'owner',
  denyPage: false,
  loads: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acc', userId: 'me', role: h.role, pageAccess: null }),
  assertPageAccess: () => { if (h.denyPage) throw Object.assign(new Error('no'), { status: 403 }) },
  toErrorResponse: (e: { status?: number }) => new Response(JSON.stringify({ error: 'x' }), { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response('', { status: 429 }) }))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/dashboard/scope', () => ({
  resolveDashboardScope: async (c: { role: string }) => ({ view: c.role === 'owner' ? 'owner' : 'team', money: c.role === 'owner', userId: null }),
}))
vi.mock('@/lib/meta-ads/ad-leads', () => ({
  loadMetaAdsPeriod: async (a: Record<string, unknown>) => { h.loads.push(a); return { connected: false } },
}))

import { clearDashboardAdsCache, GET } from './route'

const get = (q = '') => GET(new NextRequest(`http://x/api/dashboard/ads${q}`))

beforeEach(() => {
  h.role = 'owner'
  h.denyPage = false
  h.loads = []
  clearDashboardAdsCache()
})

describe('GET /api/dashboard/ads', () => {
  it('an owner gets the account’s ad spend for the asked period', async () => {
    const res = await get('?period=week')
    expect(res.status).toBe(200)
    expect(h.loads[0]).toMatchObject({ accountId: 'acc' })
    expect(typeof h.loads[0].since).toBe('string')
  })

  it('a supervisor (no money) is refused before Meta is asked', async () => {
    h.role = 'supervisor'
    const res = await get()
    expect(res.status).toBe(403)
    expect(h.loads).toHaveLength(0)
  })

  it('refuses a member without the Dashboard page', async () => {
    h.denyPage = true
    expect((await get()).status).toBe(403)
  })

  it('refuses an unknown period', async () => {
    expect((await get('?period=year')).status).toBe(400)
  })

  it('asks Meta once per account and period for five minutes', async () => {
    await get('?period=month')
    await get('?period=month')
    expect(h.loads).toHaveLength(1)
  })
})
