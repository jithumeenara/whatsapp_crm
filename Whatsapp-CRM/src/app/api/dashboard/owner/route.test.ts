import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  role: 'owner', pageOk: true, rateOk: true, pagesAsked: [] as string[],
  scope: { view: 'owner', money: true, userId: null } as { view: string; money: boolean; userId: string | null },
  built: [] as Array<Record<string, unknown>>, fail: false,
}))
const DASH = vi.hoisted(() => ({ view: 'owner', marker: 'passed-through' }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return {
    ...actual,
    requireRole: async () => ({ accountId: 'acc', userId: 'me', role: h.role }),
    assertPageAccess: (_c: unknown, page: string) => {
      h.pagesAsked.push(page)
      if (!h.pageOk) throw new actual.ForbiddenError('no')
    },
  }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: h.rateOk, limit: 30, remaining: 0, resetAt: Date.now() + 1000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'slow down' }), { status: 429 }),
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/dashboard/scope', () => ({ resolveDashboardScope: async () => h.scope }))
vi.mock('@/lib/dashboard/owner', () => ({
  getOwnerDashboard: async (a: Record<string, unknown>) => {
    if (h.fail) throw new Error('boom secret detail')
    h.built.push(a)
    return DASH
  },
}))

import { GET } from './route'

const get = (qs = '') => GET(new NextRequest(`http://x/api/dashboard/owner${qs ? `?${qs}` : ''}`))

beforeEach(() => {
  h.role = 'owner'; h.pageOk = true; h.rateOk = true; h.pagesAsked = []; h.built = []; h.fail = false
  h.scope = { view: 'owner', money: true, userId: null }
})

describe('GET /api/dashboard/owner', () => {
  it('returns what the builder returned, for the default period (month)', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(DASH)
    expect(h.built[0]).toMatchObject({ accountId: 'acc', viewerId: 'me', period: 'month', tz: 'Asia/Kolkata', scope: h.scope })
    expect(h.built[0].now).toBeInstanceOf(Date)
    expect(h.pagesAsked).toEqual(['/dashboard'])
  })

  it('accepts today and week', async () => {
    await get('period=today'); await get('period=week')
    expect(h.built.map((b) => b.period)).toEqual(['today', 'week'])
  })

  it('anything else is a plain 400 and nothing is built', async () => {
    for (const q of ['period=year', 'period=custom', 'period=']) {
      const res = await get(q)
      expect(res.status).toBe(400)
      expect(typeof (await res.json()).error).toBe('string')
    }
    expect(h.built).toHaveLength(0)
  })

  it('the scope comes from the server, never from the request', async () => {
    h.role = 'agent'; h.scope = { view: 'agent', money: false, userId: 'me' }
    await get('period=week&userId=someone&view=owner&money=1')
    expect(h.built[0].scope).toEqual({ view: 'agent', money: false, userId: 'me' })
  })

  it('someone without the Dashboard page is refused before anything is read', async () => {
    h.pageOk = false
    expect((await get()).status).toBe(403)
    expect(h.built).toHaveLength(0)
  })

  it('is rate limited', async () => {
    h.rateOk = false
    expect((await get()).status).toBe(429)
    expect(h.built).toHaveLength(0)
  })

  it('a failure says plain words, not the library\'s message', async () => {
    h.fail = true
    const res = await get()
    expect(res.status).toBe(500)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('boom')
    expect(text).toMatch(/try again/i)
  })
})
