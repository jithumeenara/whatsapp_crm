import { describe, expect, it, vi } from 'vitest'

/**
 * A chain check reads every event of the account, so it is limited per
 * account: five per ten minutes, then a plain 429 (and no walk at all).
 */

const h = vi.hoisted(() => ({ walks: 0, audited: [] as string[] }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountId: '33333333-3333-4333-8333-333333333333', role: 'owner' }),
  toErrorResponse: (e: { status?: number; message?: string }) => new Response(JSON.stringify({ error: e.message }), { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit/verify', () => ({
  verifyAccountChain: async () => {
    h.walks++
    return { ok: false, rows: 0, lastSeq: '0', lastHash: '', brokenAtSeq: '4', why: 'archived_start_unverified', message: 'Events before #4 were archived' }
  },
}))
vi.mock('@/lib/audit/write', () => ({ audit: async (_c: unknown, e: { action: string }) => { h.audited.push(e.action) } }))

import { POST } from './route'

const call = () => POST(new Request('https://crm.example/api/audit/verify', { method: 'POST' }))

describe('POST /api/audit/verify rate limit', () => {
  it('allows five checks per account in ten minutes, then refuses without walking the chain', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await call()
      expect(r.status).toBe(200)
    }
    const sixth = await call()
    expect(sixth.status).toBe(429)
    expect(sixth.headers.get('retry-after')).toBeTruthy()
    expect((await sixth.json()).error).toMatch(/checked 5 times in the last 10 minutes\. Try again in about/)
    expect(h.walks).toBe(5)
  })

  it('passes the reason and message of an unverified archived start through', async () => {
    vi.resetModules()
    const { POST: fresh } = await import('./route')
    const { checkRateLimit } = await import('@/lib/rate-limit')
    // A fresh module graph has a fresh limiter.
    expect(checkRateLimit('probe', { limit: 1, windowMs: 1000 }).success).toBe(true)
    const r = await fresh(new Request('https://crm.example/api/audit/verify', { method: 'POST' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual(expect.objectContaining({ ok: false, why: 'archived_start_unverified', message: expect.stringMatching(/archived/) }))
    expect(h.audited).toContain('access.audit_verified')
  })
})
