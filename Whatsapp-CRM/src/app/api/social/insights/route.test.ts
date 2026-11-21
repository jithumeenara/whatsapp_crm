import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Social insights route: supervisor+ with Social access, the caller's own
 * workspace, counts only (no token, no list of people), bad input refused.
 */

const h = vi.hoisted(() => ({ role: 'supervisor', authFor: [] as string[], connected: true }))

vi.mock('@/lib/auth/account', () => ({
  requirePageAccess: async (page: string, min: string) => {
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (page !== '/social' || rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc-1', userId: 'u-1', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }), RATE_LIMITS: { apiRead: {} } }))
vi.mock('@/lib/meta/social-insights', () => ({
  insightAuth: async (accountId: string, channel: string) => { h.authFor.push(`${accountId}:${channel}`); return h.connected ? { token: 'EAAsecret', nodeId: '1784' } : null },
  currentCounts: async () => ({ followers: 1200, follows: 40, media: 80 }),
  accountTotals: async (_a: string, _c: string, _auth: unknown, days: number) => ({ reach: days * 10 }),
  followerHistory: async () => [{ day: '2026-11-20', followers: 1190 }, { day: '2026-11-21', followers: 1200 }],
  instagramAudience: async () => ({ age: [{ label: '18-24', value: 300 }], gender: [], city: [] }),
}))

import { GET } from './route'

const get = (q: string) => GET(new Request(`http://x/api/social/insights${q}`))

beforeEach(() => { h.role = 'supervisor'; h.authFor = []; h.connected = true })

describe('social insights', () => {
  it("numbers for the caller's own workspace; never the token", async () => {
    const res = await get('?channel=instagram&days=30')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(h.authFor).toEqual(['acc-1:instagram'])
    expect(body.totals).toEqual({ reach: 300 })
    expect(body.audience.age[0]).toEqual({ label: '18-24', value: 300 })
    expect(JSON.stringify(body)).not.toContain('EAA')
  })
  it('an agent is refused; a bad channel is refused; an odd period falls back to 7 days', async () => {
    h.role = 'agent'
    expect((await get('?channel=instagram')).status).toBe(403)
    h.role = 'owner'
    expect((await get('?channel=whatsapp')).status).toBe(400)
    expect((await (await get('?channel=facebook&days=9999')).json()).days).toBe(7)
  })
  it('not connected: a plain 404, nothing fetched', async () => {
    h.connected = false
    expect((await get('?channel=facebook')).status).toBe(404)
  })
})
