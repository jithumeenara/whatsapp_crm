import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * PATCH /api/account took any text as the business's currency, trimmed and
 * upper-cased, so "ABC" or "<b>" became the currency every deal and report
 * printed. It must be a real currency from the list.
 */

const h = vi.hoisted(() => ({
  updates: [] as Array<Record<string, any>>,
  profileUpserts: [] as Array<Record<string, any>>,
  repriced: [] as string[],
  current: 'USD',
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: 'admin' }),
  getCurrentAccount: () => Promise.resolve({ account: {}, role: 'admin' }),
  toErrorResponse: (e: any) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ audit: () => Promise.resolve(), auditCtx: () => ({}) }))
vi.mock('@/lib/whatsapp/message-cost', () => ({
  repriceUnpricedCosts: (accountId: string) => {
    h.repriced.push(accountId)
    return Promise.resolve(0)
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    accountReportProfile: {
      upsert: (a: any) => {
        h.profileUpserts.push(a)
        return Promise.resolve({})
      },
    },
    account: {
      findUnique: () => Promise.resolve({ name: 'Acme', default_currency: h.current }),
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
  h.profileUpserts = []
  h.repriced = []
  h.current = 'USD'
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

describe('PATCH /api/account: changing the currency does what the Settings card does', () => {
  it('records when it changed and prices again the costs that had no rate card', async () => {
    // Found in review: this path used to change the currency and nothing else, so
    // two screens behaved differently for the same change.
    const res = await patch({ default_currency: 'inr' })
    expect(res.status).toBe(200)
    expect(h.profileUpserts).toHaveLength(1)
    expect(h.profileUpserts[0].update.currency_effective_from).toBeInstanceOf(Date)
    expect(h.repriced).toEqual(['acc-1'])
  })

  it('does neither when the currency is the same one', async () => {
    h.current = 'INR'
    await patch({ default_currency: 'INR' })
    expect(h.profileUpserts).toHaveLength(0)
    expect(h.repriced).toHaveLength(0)
  })
})
