import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The tax % setting: admins only, validated on the server, own workspace, audited. */

const h = vi.hoisted(() => ({ role: 'admin', upserts: [] as Array<{ where: unknown; create: Record<string, unknown> }>, audits: 0 }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (h.role === 'agent') throw Object.assign(new Error('Forbidden'), { status: 403 })
    return { userId: 'u1', accountId: 'acc-1', role: h.role }
  },
  toErrorResponse: (e: { status?: number; message?: string }) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => { h.audits += 1 } }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }))
vi.mock('@/lib/ai/budget', () => ({ forgetBudget: () => {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    aiCostSettings: {
      findUnique: async () => ({ tax_percent: 18 }),
      upsert: async (a: { where: unknown; create: Record<string, unknown> }) => { h.upserts.push(a); return {} },
    },
  },
}))

import { GET, PUT } from './route'

const put = (body: unknown) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }))
beforeEach(() => { h.role = 'admin'; h.upserts = []; h.audits = 0 })

describe('/api/ai-usage/cost-settings', () => {
  it('an agent cannot change it', async () => {
    h.role = 'agent'
    expect((await put({ tax_percent: 18 })).status).toBe(403)
    expect(h.upserts).toHaveLength(0)
  })

  it('rejects anything but 0–100 with two decimals', async () => {
    for (const bad of [-1, 101, 18.555, 'x', null]) expect((await put({ tax_percent: bad })).status).toBe(400)
    expect(h.upserts).toHaveLength(0)
  })

  it("saves only the tax, in the caller's own workspace, audited", async () => {
    const res = await put({ tax_percent: 18, account_id: 'other' })
    expect(res.status).toBe(200)
    expect(h.upserts[0].where).toEqual({ account_id: 'acc-1' })
    expect(h.upserts[0].create).toEqual({ account_id: 'acc-1', tax_percent: 18, updated_by: 'u1' })
    expect(h.audits).toBe(1)
    expect(await (await GET()).json()).toEqual({ tax_percent: 18 })
  })
})
