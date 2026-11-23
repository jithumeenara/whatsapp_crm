import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Setting the monthly AI limit: admins only, one number from the body,
 * range-checked on the server, always written to the caller's own
 * workspace, and every change audited.
 */

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  upserts: [] as Array<{ where: unknown; create: Record<string, unknown> }>,
  deletes: [] as unknown[],
  audits: 0,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    if (min === 'admin' && h.role === 'agent') throw Object.assign(new Error('Forbidden'), { status: 403 })
    return { userId: 'u1', accountId: 'acc-1', role: h.role }
  },
  toErrorResponse: (e: { status?: number; message?: string }) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => { h.audits += 1 } }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }) }))
vi.mock('@/lib/ai/budget', () => ({
  MAX_LIMIT_USD: 100_000,
  WARN_RATIO: 0.8,
  forgetBudget: () => {},
  aiBudgetState: async () => ({ limitUsd: 25, spentUsd: 3.456, month: '2026-11', ratio: 0.138, over: false }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    aiBudget: {
      findUnique: async () => null,
      upsert: async (args: { where: unknown; create: Record<string, unknown> }) => { h.upserts.push(args); return {} },
      deleteMany: async (args: unknown) => { h.deletes.push(args); return { count: 1 } },
    },
  },
}))

import { DELETE, GET, PUT } from './route'

const put = (body: unknown) => PUT(new Request('http://x/api/ai-usage/budget', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => { h.role = 'admin'; h.upserts = []; h.deletes = []; h.audits = 0 })

describe('the AI budget route', () => {
  it('an agent cannot read or set it', async () => {
    h.role = 'agent'
    expect((await GET()).status).toBe(403)
    expect((await put({ monthly_limit_usd: 50 })).status).toBe(403)
    expect(h.upserts).toHaveLength(0)
  })

  it('rejects anything that is not a sensible amount', async () => {
    for (const bad of [0, -5, 0.5, 'abc', null, 1e9, Infinity]) {
      expect((await put({ monthly_limit_usd: bad })).status).toBe(400)
    }
    expect(h.upserts).toHaveLength(0)
  })

  it("saves only the amount, rounded to cents, in the caller's own workspace, and audits it", async () => {
    const res = await put({ monthly_limit_usd: 25.555, account_id: 'someone-else', warned_month: '2020-01' })
    expect(res.status).toBe(200)
    expect(h.upserts[0].where).toEqual({ account_id: 'acc-1' })
    expect(h.upserts[0].create).toEqual({ account_id: 'acc-1', monthly_limit_usd: 25.56, updated_by: 'u1' })
    expect(h.audits).toBe(1)
  })

  it('removing the limit touches only this workspace', async () => {
    await DELETE(new Request('http://x/api/ai-usage/budget', { method: 'DELETE' }))
    expect(h.deletes).toEqual([{ where: { account_id: 'acc-1' } }])
  })

  it('reports the spend rounded to cents', async () => {
    const body = await (await GET()).json()
    expect(body).toMatchObject({ monthly_limit_usd: 25, spent_usd: 3.46, over: false })
  })
})
