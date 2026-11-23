import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who sees which errors: an admin sees only their workspace's; server-wide
 * errors (internal details of the whole server) only the server's owner.
 */

const h = vi.hoisted(() => ({ owner: false, role: 'admin', where: null as unknown, updWhere: null as unknown, updCount: 1 }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (h.role === 'agent') throw Object.assign(new Error('Forbidden'), { status: 403 })
    return { userId: 'u1', accountId: 'acc-1', role: h.role }
  },
  toErrorResponse: (e: { status?: number; message?: string }) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/auth/platform-owner', () => ({ isPlatformOwner: async () => h.owner }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    appError: {
      findMany: async ({ where }: { where: unknown }) => { h.where = where; return [] },
      updateMany: async ({ where }: { where: unknown }) => { h.updWhere = where; return { count: h.updCount } },
    },
  },
}))

import { GET, PATCH } from './route'

const ID = '11111111-2222-4333-8444-555555555555'
beforeEach(() => { h.owner = false; h.role = 'admin'; h.where = null; h.updWhere = null; h.updCount = 1 })

describe('/api/system/errors', () => {
  it('an agent cannot see errors', async () => {
    h.role = 'agent'
    expect((await GET(new Request('http://x/api/system/errors'))).status).toBe(403)
  })

  it('an admin sees only their own workspace, open errors by default', async () => {
    await GET(new Request('http://x/api/system/errors'))
    expect(h.where).toEqual({ account_id: 'acc-1', resolved_at: null })
  })

  it('the server owner also sees server-wide errors', async () => {
    h.owner = true
    await GET(new Request('http://x/api/system/errors?show=all'))
    expect(h.where).toEqual({ OR: [{ account_id: 'acc-1' }, { account_id: null }] })
  })

  it('resolving is limited to rows the caller may see, and checks the id', async () => {
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ id: 'nope', action: 'resolve' }) }))).status).toBe(400)
    await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ id: ID, action: 'resolve' }) }))
    expect(h.updWhere).toEqual({ id: ID, resolved_at: null, account_id: 'acc-1' })
  })
})
