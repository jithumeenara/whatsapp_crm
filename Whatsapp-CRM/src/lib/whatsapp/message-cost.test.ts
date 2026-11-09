import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Recording what a WhatsApp message cost, from the status webhook.
 *
 * What must hold: a status Meta delivers twice counts once; an event for a
 * message that is not this business's (or that we never sent) records
 * nothing; a message that failed before delivery is not charged; and no
 * price is invented when there is no rate card for the business's currency.
 */

type Cost = Record<string, any>

const h = vi.hoisted(() => ({
  costs: [] as Cost[],
  message: null as null | Record<string, any>,
  currency: 'INR' as string,
  messageWhere: null as any,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    account: { findUnique: () => Promise.resolve({ default_currency: h.currency }) },
    message: {
      findFirst: ({ where }: any) => {
        h.messageWhere = where
        return Promise.resolve(h.message)
      },
    },
    whatsAppMessageCost: {
      createMany: ({ data, skipDuplicates }: { data: Cost[]; skipDuplicates?: boolean }) => {
        let count = 0
        for (const row of data) {
          const dup = h.costs.some((c) => c.account_id === row.account_id && c.message_id === row.message_id)
          if (dup && skipDuplicates) continue
          if (dup) throw new Error('unique violation')
          h.costs.push({ ...row })
          count++
        }
        return Promise.resolve({ count })
      },
      updateMany: ({ where, data }: any) => {
        let count = 0
        for (const c of h.costs) {
          if (c.account_id !== where.account_id || c.message_id !== where.message_id) continue
          if (where.delivered_at === null && c.delivered_at) continue
          if (where.voided_at === null && c.voided_at) continue
          Object.assign(c, data)
          count++
        }
        return Promise.resolve({ count })
      },
    },
  },
}))

import { recordMessageCost } from './message-cost'

const T0 = new Date('2026-11-09T10:00:00Z')
const T1 = new Date('2026-11-09T10:00:05Z')
const PRICING = { billable: true, pricing_model: 'PMP', type: 'regular', category: 'marketing' }

const base = {
  accountId: 'acc-A',
  wamid: 'wamid.1',
  recipient: '919188318031',
}

beforeEach(() => {
  h.costs = []
  h.currency = 'INR'
  h.messageWhere = null
  h.message = {
    sender_type: 'agent',
    sender_id: 'user-1',
    template_name: 'offer',
    broadcast_id: null,
    conversation_id: 'conv-1',
    conversation: { whatsapp_config_id: 'num-1' },
  }
})

describe('recordMessageCost', () => {
  it('records the charge with the price from Meta\'s card and who sent it', async () => {
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: PRICING })
    expect(h.costs).toHaveLength(1)
    expect(h.costs[0]).toMatchObject({
      account_id: 'acc-A',
      message_id: 'wamid.1',
      sender_user_id: 'user-1',
      sender_type: 'agent',
      whatsapp_config_id: 'num-1',
      pricing_category: 'marketing',
      pricing_type: 'regular',
      recipient_market: 'India',
      amount: '0.863100',
      currency: 'INR',
      rate_known: true,
      rate_version: 'INR 2026-10-01',
      delivered_at: null,
    })
  })

  it('counts a status that arrives twice once, and for every status that carries pricing', async () => {
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: PRICING })
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: PRICING })
    await recordMessageCost({ ...base, status: 'delivered', timestamp: T1, pricing: PRICING })
    expect(h.costs).toHaveLength(1)
    expect(h.costs[0].delivered_at).toEqual(T1)
  })

  it('records nothing for a message that is not this business\'s, or that we never sent', async () => {
    h.message = null
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: PRICING })
    expect(h.costs).toHaveLength(0)
    // the lookup is scoped to the business
    expect(JSON.stringify(h.messageWhere)).toContain('acc-A')
  })

  it('records nothing when the status carries no pricing', async () => {
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: undefined })
    expect(h.costs).toHaveLength(0)
  })

  it('does not charge a message that failed before delivery', async () => {
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: PRICING })
    await recordMessageCost({ ...base, status: 'failed', timestamp: T1, pricing: undefined })
    expect(h.costs[0].voided_at).toBeInstanceOf(Date)
  })

  it('does not void a message that was already delivered', async () => {
    await recordMessageCost({ ...base, status: 'delivered', timestamp: T0, pricing: PRICING })
    await recordMessageCost({ ...base, status: 'failed', timestamp: T1, pricing: undefined })
    expect(h.costs[0].voided_at ?? null).toBeNull()
  })

  it('records a free message as a real zero', async () => {
    await recordMessageCost({
      ...base, status: 'delivered', timestamp: T0,
      pricing: { billable: false, pricing_model: 'PMP', type: 'free_customer_service', category: 'utility' },
    })
    expect(h.costs[0]).toMatchObject({ amount: '0.000000', rate_known: true, pricing_type: 'free_customer_service' })
  })

  it('does not invent a price when the business\'s currency has no rate card', async () => {
    h.currency = 'USD'
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: PRICING })
    expect(h.costs[0]).toMatchObject({ amount: null, rate_known: false, pricing_category: 'marketing' })
  })

  it('keeps what Meta reported, whole', async () => {
    await recordMessageCost({ ...base, status: 'sent', timestamp: T0, pricing: { ...PRICING, subtype: 'x' } })
    expect(h.costs[0].raw_pricing).toEqual({ ...PRICING, subtype: 'x' })
  })
})
