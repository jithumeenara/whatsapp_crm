import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * PATCH /api/account took any text as the business's currency, trimmed and
 * upper-cased, so "ABC" or "<b>" became the currency every deal and report
 * printed. It must be a real currency from the list.
 */

const h = vi.hoisted(() => ({ updates: [] as Array<Record<string, any>> }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: 'admin' }),
  getCurrentAccount: () => Promise.resolve({ account: {}, role: 'admin' }),
  toErrorResponse: (e: any) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ audit: () => Promise.resolve(), auditCtx: () => ({}) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    account: {
      findUnique: () => Promise.resolve({ name: 'Acme', default_currency: 'USD' }),
      update: ({ data }: any) => {
        h.updates.push(data)
        return Promise.resolve({ id: 'acc-1', name: 'Acme', ...data })
      },
    },
  },
}))

import { PATCH } from './route'

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/account', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  h.updates = []
})

describe('PATCH /api/account: currency', () => {
  it('refuses a currency that is not on the list, and writes nothing', async () => {
    for (const default_currency of ['ABC', '<b>', 'US', 'dollars', 5]) {
      const res = await patch({ default_currency })
      expect(res.status).toBe(400)
    }
    expect(h.updates).toHaveLength(0)
  })

  it('accepts a listed currency in any case and stores it upper case', async () => {
    const res = await patch({ default_currency: 'inr' })
    expect(res.status).toBe(200)
    expect(h.updates[0].default_currency).toBe('INR')
  })
})
