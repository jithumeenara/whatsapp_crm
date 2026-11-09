import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A business that had no rate card for its currency (it was still on the
 * default USD) has costs recorded without a price. When it sets its real
 * currency those rows are priced from the card that was in force on their
 * own date, once. Rows that already have a price are never touched, and a
 * currency with no card prices nothing.
 */

type Row = {
  id: string; account_id: string; recipient_market: string; pricing_category: string; pricing_type: string
  occurred_at: Date; amount: string | null; rate_known: boolean; voided_at: Date | null
  currency?: string | null; rate_version?: string | null
}

const h = vi.hoisted(() => ({ rows: [] as any[], currency: 'INR' }))

vi.mock('@/lib/db', () => ({
  prisma: {
    account: { findUnique: () => Promise.resolve({ default_currency: h.currency }) },
    whatsAppMessageCost: {
      findMany: ({ where }: any) =>
        Promise.resolve(
          h.rows.filter(
            (r: Row) =>
              r.account_id === where.account_id && r.rate_known === false && r.amount === null && r.voided_at === null,
          ),
        ),
      updateMany: ({ where, data }: any) => {
        const row = h.rows.find((r: Row) => r.id === where.id && r.rate_known === where.rate_known)
        if (!row) return Promise.resolve({ count: 0 })
        Object.assign(row, data)
        return Promise.resolve({ count: 1 })
      },
    },
  },
}))

import { repriceUnpricedCosts } from './message-cost'

const row = (over: Partial<Row>): Row => ({
  id: 'r1', account_id: 'acc-A', recipient_market: 'India', pricing_category: 'marketing', pricing_type: 'regular',
  occurred_at: new Date('2026-11-01T10:00:00Z'), amount: null, rate_known: false, voided_at: null, ...over,
})

beforeEach(() => {
  h.currency = 'INR'
  h.rows = [row({})]
})

describe('repriceUnpricedCosts', () => {
  it('prices a cost that had no rate card, from the card in force on its date', async () => {
    const n = await repriceUnpricedCosts('acc-A')
    expect(n).toBe(1)
    expect(h.rows[0]).toMatchObject({ amount: '0.863100', currency: 'INR', rate_known: true, rate_version: 'INR 2026-10-01' })
  })

  it('leaves a cost from before the card took effect unpriced', async () => {
    h.rows = [row({ occurred_at: new Date('2026-09-15T10:00:00Z') })]
    expect(await repriceUnpricedCosts('acc-A')).toBe(0)
    expect(h.rows[0].amount).toBeNull()
  })

  it('prices nothing when the currency has no card', async () => {
    h.currency = 'USD'
    expect(await repriceUnpricedCosts('acc-A')).toBe(0)
    expect(h.rows[0].rate_known).toBe(false)
  })

  it('never touches a cost that already has a price, or another business\'s', async () => {
    h.rows = [
      row({ id: 'priced', amount: '9.000000', rate_known: true }),
      row({ id: 'theirs', account_id: 'acc-B' }),
    ]
    expect(await repriceUnpricedCosts('acc-A')).toBe(0)
    expect(h.rows.find((r: Row) => r.id === 'priced')!.amount).toBe('9.000000')
    expect(h.rows.find((r: Row) => r.id === 'theirs')!.amount).toBeNull()
  })

  it('does not price a message that failed before delivery', async () => {
    h.rows = [row({ voided_at: new Date() })]
    expect(await repriceUnpricedCosts('acc-A')).toBe(0)
  })
})
