import { describe, expect, it } from 'vitest'
import { assembleBroadcasts, totalsOf } from './campaign-data'

const raw = [
  { id: 'b1', name: 'Diwali offer', template: 'diwali_1', sent: 200, delivered: 180, read: 120, replied: 30, failed: 20 },
  { id: 'b2', name: 'Reminder', template: 'remind', sent: 40, delivered: 40, read: 10, replied: 0, failed: 0 },
]

describe('assembleBroadcasts', () => {
  it('rates are of messages that reached the person; cost per reply only in the business currency', () => {
    const rows = assembleBroadcasts(raw, [
      { id: 'b1', currency: 'INR', amount: 150 },
      { id: 'b1', currency: 'USD', amount: 2 },
      { id: 'b2', currency: 'INR', amount: 32 },
    ], [{ id: 'b1', leads: 6, won: 2 }], 'INR')
    const b1 = rows.find((r) => r.id === 'b1')!
    expect(b1).toMatchObject({ deliveredPct: 90, readPct: 66.7, repliedPct: 16.7, cost: 150, otherCurrency: true, costPerReply: 5, leads: 6, won: 2 })
    const b2 = rows.find((r) => r.id === 'b2')!
    expect(b2.costPerReply).toBeNull() // no replies: not "₹0 per reply"
    expect(b2).toMatchObject({ leads: 0, won: 0, otherCurrency: false })
  })

  it('busiest first; nothing delivered gives unknown rates, never 0%', () => {
    const rows = assembleBroadcasts([{ id: 'b3', name: 'X', template: 't', sent: 0, delivered: 0, read: 0, replied: 0, failed: 5 }, ...raw], [], [], 'INR')
    expect(rows[0].id).toBe('b1')
    const b3 = rows.find((r) => r.id === 'b3')!
    expect(b3.readPct).toBeNull()
    expect(b3.cost).toBeNull()
  })
})

describe('totalsOf', () => {
  it('adds the broadcasts up and works out the shares from the totals', () => {
    const t = totalsOf(assembleBroadcasts(raw, [{ id: 'b1', currency: 'INR', amount: 150 }], [], 'INR'))
    expect(t).toMatchObject({ broadcasts: 2, sent: 240, delivered: 220, replied: 30, failed: 20, cost: 150, costPerReply: 5 })
    expect(t.repliedPct).toBe(13.6)
  })
})
