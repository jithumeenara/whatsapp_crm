import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Setting the monthly AI limit: admins only, in the business's own
 * currency (taken from the account, never the body), with a confirmed
 * USD rate, range-checked on the server, written to the caller's own
 * workspace, and audited.
 */

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  currency: 'INR',
  upserts: [] as Array<{ where: unknown; create: Record<string, unknown> }>,
  deletes: [] as unknown[],
  audits: 0,
  state: { limitUsd: 25, spentUsd: 3.456, month: '2026-11', ratio: 0.138, over: false, currency: 'INR', usdRate: 88 } as Record<string, unknown>,
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
  aiBudgetState: async () => h.state,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    account: { findUnique: async () => ({ default_currency: h.currency }) },
    aiBudget: {
      findUnique: async () => null,
      upsert: async (args: { where: unknown; create: Record<string, unknown> }) => { h.upserts.push(args); return {} },
      deleteMany: async (args: unknown) => { h.deletes.push(args); return { count: 1 } },
    },
  },
}))

import { DELETE, GET, PUT } from './route'

const put = (body: unknown) => PUT(new Request('http://x/api/ai-usage/budget', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => {
  h.role = 'admin'; h.currency = 'INR'; h.upserts = []; h.deletes = []; h.audits = 0
  h.state = { limitUsd: 25, spentUsd: 3.456, month: '2026-11', ratio: 0.138, over: false, currency: 'INR', usdRate: 88 }
})

describe('the AI budget route', () => {
  it('an agent cannot read or set it', async () => {
    h.role = 'agent'
    expect((await GET()).status).toBe(403)
    expect((await put({ amount: 2000, usd_rate: 88 })).status).toBe(403)
    expect(h.upserts).toHaveLength(0)
  })

  it('rejects anything that is not a sensible amount or rate', async () => {
    for (const bad of [0, -5, 'abc', null, 1e12, Infinity]) {
      expect((await put({ amount: bad, usd_rate: 88 })).status).toBe(400)
    }
    for (const badRate of [0, -1, 'x', null, 1e7]) {
      expect((await put({ amount: 2000, usd_rate: badRate })).status).toBe(400)
    }
    expect(h.upserts).toHaveLength(0)
  })

  it("saves in the business currency (not the body's), enforced in USD, in the caller's own workspace, audited", async () => {
    const res = await put({ amount: 2200, usd_rate: 88, currency: 'USD', account_id: 'someone-else', warned_month: '2020-01' })
    expect(res.status).toBe(200)
    expect(h.upserts[0].where).toEqual({ account_id: 'acc-1' })
    expect(h.upserts[0].create).toEqual({ account_id: 'acc-1', monthly_limit_usd: 25, currency: 'INR', usd_rate: 88, updated_by: 'u1' })
    expect(h.audits).toBe(1)
  })

  it('removing the limit touches only this workspace', async () => {
    await DELETE(new Request('http://x/api/ai-usage/budget', { method: 'DELETE' }))
    expect(h.deletes).toEqual([{ where: { account_id: 'acc-1' } }])
  })

  it('reports limit and spend in the business currency with the saved rate', async () => {
    const body = await (await GET()).json()
    expect(body).toMatchObject({ currency: 'INR', usd_rate: 88, rate_is_suggested: false, limit_amount: 2200, spent_amount: 304.13, over: false })
  })

  it('a business whose currency changed gets a suggested rate, not the old one', async () => {
    h.currency = 'AED'
    const body = await (await GET()).json()
    expect(body).toMatchObject({ currency: 'AED', usd_rate: 3.6725, rate_is_suggested: true })
  })
})
