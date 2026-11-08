import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  args: [] as Array<Record<string, unknown>>,
  allow: true,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'agent', pageAccess: ['/leads'] }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'x' }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: h.allow }),
  rateLimitResponse: () => new Response('slow down', { status: 429 }),
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/notifications/bell', () => ({
  loadBell: async (a: Record<string, unknown>) => {
    h.args.push(a)
    return { items: [], total: 0 }
  },
}))

import { GET } from './route'

beforeEach(() => {
  h.args = []
  h.allow = true
})

describe('GET /api/notifications/bell', () => {
  it('loads the signed-in person’s own counts, in their account, with their page access', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.args[0]).toMatchObject({ accountId: 'acc', userId: 'me', role: 'agent', pageAccess: ['/leads'], tz: 'Asia/Kolkata' })
  })

  it('is rate limited', async () => {
    h.allow = false
    const res = await GET()
    expect(res.status).toBe(429)
    expect(h.args).toHaveLength(0)
  })
})
