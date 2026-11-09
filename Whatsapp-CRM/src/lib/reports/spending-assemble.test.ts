import { describe, expect, it } from 'vitest'
import { assembleSpending, channelLabel, type SpendingRows } from './spending-assemble'

/**
 * The Spending report's arithmetic, apart from the database.
 *
 * The rules that matter: money in different currencies is never added;
 * what cannot be attributed to a person or channel is shown as such, not
 * guessed; an empty period is zeros, not an error; and a combined total
 * exists only when every part of it can honestly be put in one currency.
 */

const empty = (over: Partial<SpendingRows> = {}): SpendingRows => ({
  waCategory: [], waNumber: [], waPerson: [], waDay: [], waPending: 0,
  aiFeature: [], aiChannel: [], aiPerson: [], aiDay: [],
  numbers: {}, people: {}, teams: {},
  ads: { connected: false, spend: null, currency: null, clicks: 0, impressions: 0, error: null },
  leads: 0, wonDeals: 0, businessCurrency: 'INR', usdRate: 88.5,
  ...over,
})

describe('channelLabel', () => {
  it('writes channels the way people do, and leaves anything else alone', () => {
    expect(channelLabel('whatsapp')).toBe('WhatsApp')
    expect(channelLabel('sms')).toBe('SMS')
    expect(channelLabel('Not attributed')).toBe('Not attributed')
    expect(channelLabel('something-new')).toBe('something-new')
  })
})

describe('assembleSpending: an empty period', () => {
  it('is zeros and empty lists, never an error', () => {
    const r = assembleSpending(empty())
    expect(r.whatsapp.delivered).toBe(0)
    expect(r.whatsapp.total).toEqual({})
    expect(r.whatsapp.byCategory).toEqual([])
    expect(r.ai.calls).toBe(0)
    expect(r.ai.costUsd).toBe(0)
    expect(r.byTeam).toEqual([])
    expect(r.byChannel).toEqual([])
    expect(r.totals.combined).toBe(0)
    expect(r.outcomes.costPerLead).toBeNull()
    expect(r.outcomes.costPerWon).toBeNull()
  })
})

describe('assembleSpending: WhatsApp', () => {
  const rows = empty({
    waCategory: [
      { category: 'marketing', type: 'regular', currency: 'INR', n: 100, amount: 86.31, unpriced: 0 },
      { category: 'utility', type: 'regular', currency: 'INR', n: 50, amount: 5.75, unpriced: 0 },
      { category: 'utility', type: 'free_customer_service', currency: 'INR', n: 30, amount: 0, unpriced: 0 },
      { category: 'marketing', type: 'regular', currency: 'USD', n: 4, amount: 1, unpriced: 0 },
      { category: 'service', type: 'regular', currency: null, n: 7, amount: 0, unpriced: 7 },
    ],
    waPending: 3,
  })

  it('totals each currency on its own and never adds them', () => {
    const r = assembleSpending(rows)
    expect(r.whatsapp.total).toEqual({ INR: 92.06, USD: 1 })
    expect(r.whatsapp.delivered).toBe(191)
  })

  it('counts free messages as free and unpriced ones as unpriced, not as zero cost', () => {
    const r = assembleSpending(rows)
    expect(r.whatsapp.free).toBe(30)
    expect(r.whatsapp.unpriced).toBe(7)
    expect(r.whatsapp.pending).toBe(3)
  })

  it('lists categories by spend, with the unpriced count beside each', () => {
    const r = assembleSpending(rows)
    expect(r.whatsapp.byCategory[0]).toMatchObject({ category: 'marketing', type: 'regular' })
    expect(r.whatsapp.byCategory.find((c) => c.type === 'free_customer_service')).toMatchObject({ count: 30, amount: { INR: 0 } })
    expect(r.whatsapp.byCategory.find((c) => c.category === 'service')).toMatchObject({ unpriced: 7 })
  })

  it('names the numbers, and keeps one that was removed as "Removed number"', () => {
    const r = assembleSpending(empty({
      waNumber: [
        { id: 'n1', currency: 'INR', n: 10, amount: 5 },
        { id: 'gone', currency: 'INR', n: 2, amount: 1 },
        { id: null, currency: 'INR', n: 1, amount: 0.5 },
      ],
      numbers: { n1: 'Admissions' },
    }))
    const labels = r.whatsapp.byNumber.map((x) => x.label)
    expect(labels).toEqual(['Admissions', 'Removed number', 'Not recorded'])
  })

  it('tells a person from the bot, automations and the system', () => {
    const r = assembleSpending(empty({
      waPerson: [
        { userId: 'u1', senderType: 'agent', currency: 'INR', n: 10, amount: 4 },
        { userId: null, senderType: 'bot', currency: 'INR', n: 5, amount: 2 },
        { userId: null, senderType: 'system', currency: 'INR', n: 1, amount: 0.1 },
        { userId: null, senderType: null, currency: 'INR', n: 1, amount: 0.1 },
      ],
      people: { u1: 'Asha' },
    }))
    const kinds = Object.fromEntries(r.whatsapp.byPerson.map((p) => [p.name, p.kind]))
    expect(kinds).toEqual({ Asha: 'person', 'AI assistant': 'bot', System: 'system', 'Not recorded': 'unknown' })
  })

  it('shows a member who has since been removed by a plain name, not an id', () => {
    const r = assembleSpending(empty({
      waPerson: [{ userId: 'u-gone', senderType: 'agent', currency: 'INR', n: 3, amount: 1 }],
    }))
    expect(r.whatsapp.byPerson[0].name).toBe('Former member')
  })
})

describe('assembleSpending: AI', () => {
  it('keeps work that was not for anyone in its own line, and never invents a person', () => {
    const r = assembleSpending(empty({
      aiFeature: [{ feature: 'chat_customer', calls: 10, costUsd: 0.5 }, { feature: 'embedding', calls: 2, costUsd: 0.1 }],
      aiPerson: [{ userId: 'u1', calls: 4, costUsd: 0.2 }, { userId: null, calls: 8, costUsd: 0.4 }],
      aiChannel: [{ channel: 'whatsapp', calls: 6, costUsd: 0.3 }, { channel: null, calls: 6, costUsd: 0.3 }],
      people: { u1: 'Asha' },
    }))
    expect(r.ai.calls).toBe(12)
    expect(r.ai.costUsd).toBeCloseTo(0.6, 6)
    expect(r.ai.byPerson.map((p) => p.name)).toEqual(['Asha', 'Not attributed'])
    expect(r.ai.unattributed).toEqual({ calls: 8, costUsd: 0.4 })
    expect(r.ai.byChannel.map((c) => c.channel)).toEqual(['whatsapp', 'Not attributed'])
  })

  it('shows the rupee figure at a stated rate for a business that works in rupees', () => {
    const r = assembleSpending(empty({ aiFeature: [{ feature: 'chat_customer', calls: 1, costUsd: 2 }] }))
    expect(r.ai.inBusinessCurrency).toEqual({ currency: 'INR', amount: 177, rate: 88.5 })
  })

  it('shows dollars as dollars for a dollar business, and no conversion for any other', () => {
    const usd = assembleSpending(empty({ businessCurrency: 'USD', aiFeature: [{ feature: 'x', calls: 1, costUsd: 2 }] }))
    expect(usd.ai.inBusinessCurrency).toEqual({ currency: 'USD', amount: 2, rate: 1 })
    const eur = assembleSpending(empty({ businessCurrency: 'EUR', aiFeature: [{ feature: 'x', calls: 1, costUsd: 2 }] }))
    expect(eur.ai.inBusinessCurrency).toBeNull()
  })
})

describe('assembleSpending: teams and channels', () => {
  const rows = empty({
    waPerson: [
      { userId: 'u1', senderType: 'agent', currency: 'INR', n: 10, amount: 4 },
      { userId: 'u2', senderType: 'agent', currency: 'INR', n: 5, amount: 2 },
      { userId: 'u3', senderType: 'agent', currency: 'INR', n: 5, amount: 1 },
    ],
    aiPerson: [{ userId: 'u1', calls: 3, costUsd: 0.3 }, { userId: 'u3', calls: 1, costUsd: 0.1 }],
    people: { u1: 'Asha', u2: 'Ravi', u3: 'Meera' },
    teams: { u1: 'Sales', u2: 'Sales' },
  })

  it('adds a team\'s people up, and puts people without a team under "No team"', () => {
    const r = assembleSpending(rows)
    const sales = r.byTeam.find((t) => t.team === 'Sales')!
    expect(sales.people).toBe(2)
    expect(sales.whatsapp).toEqual({ INR: 6 })
    expect(sales.aiUsd).toBeCloseTo(0.3, 6)
    const none = r.byTeam.find((t) => t.team === 'No team')!
    expect(none.whatsapp).toEqual({ INR: 1 })
  })

  it('does not put the bot or the system in any team', () => {
    const r = assembleSpending(empty({
      waPerson: [{ userId: null, senderType: 'bot', currency: 'INR', n: 5, amount: 2 }],
    }))
    expect(r.byTeam).toEqual([])
  })

  it('splits cost by channel: WhatsApp messages, then AI on each channel', () => {
    const r = assembleSpending(empty({
      waCategory: [{ category: 'marketing', type: 'regular', currency: 'INR', n: 10, amount: 8.63, unpriced: 0 }],
      aiChannel: [{ channel: 'whatsapp', calls: 2, costUsd: 0.2 }, { channel: 'instagram', calls: 1, costUsd: 0.1 }],
    }))
    const wa = r.byChannel.find((c) => c.channel === 'whatsapp')!
    expect(wa.messages).toEqual({ INR: 8.63 })
    expect(wa.aiUsd).toBeCloseTo(0.2, 6)
    expect(r.byChannel.find((c) => c.channel === 'instagram')).toMatchObject({ messages: {} })
  })
})

describe('assembleSpending: the combined total and cost per result', () => {
  it('adds WhatsApp, AI and ads only when they can honestly share a currency', () => {
    const r = assembleSpending(empty({
      waCategory: [{ category: 'marketing', type: 'regular', currency: 'INR', n: 10, amount: 100, unpriced: 0 }],
      aiFeature: [{ feature: 'x', calls: 1, costUsd: 1 }],
      ads: { connected: true, spend: 1000, currency: 'INR', clicks: 10, impressions: 100, error: null },
      leads: 20, wonDeals: 5,
    }))
    expect(r.totals).toMatchObject({ combinedCurrency: 'INR', combined: 1188.5, excluded: [] })
    expect(r.outcomes.costPerLead).toBeCloseTo(59.425, 6)
    expect(r.outcomes.costPerWon).toBeCloseTo(237.7, 6)
  })

  it('leaves out, and says so, an amount in another currency', () => {
    const r = assembleSpending(empty({
      waCategory: [
        { category: 'marketing', type: 'regular', currency: 'INR', n: 10, amount: 100, unpriced: 0 },
        { category: 'marketing', type: 'regular', currency: 'USD', n: 1, amount: 5, unpriced: 0 },
      ],
      ads: { connected: true, spend: 50, currency: 'USD', clicks: 1, impressions: 1, error: null },
    }))
    expect(r.totals.combined).toBe(100)
    expect(r.totals.excluded.join(' ')).toMatch(/USD/)
    expect(r.totals.perCurrency).toEqual({ INR: 100, USD: 55 })
  })

  it('gives no cost per lead when the period has no leads, and none when something was left out', () => {
    const none = assembleSpending(empty({ waCategory: [{ category: 'utility', type: 'regular', currency: 'INR', n: 1, amount: 1, unpriced: 0 }] }))
    expect(none.outcomes.costPerLead).toBeNull()
    const left = assembleSpending(empty({
      leads: 10,
      waCategory: [{ category: 'utility', type: 'regular', currency: 'USD', n: 1, amount: 1, unpriced: 0 }],
    }))
    expect(left.outcomes.costPerLead).toBeNull()
  })

  it('reports an ad spend it could not read as such, not as zero', () => {
    const r = assembleSpending(empty({
      ads: { connected: true, spend: null, currency: null, clicks: 0, impressions: 0, error: 'Could not read ad spend from Meta.' },
    }))
    expect(r.ads.error).toMatch(/Could not read/)
    expect(r.ads.spend).toBeNull()
  })
})

describe('assembleSpending: days', () => {
  it('lines WhatsApp, AI and ads up on the same days, in order', () => {
    const r = assembleSpending(empty({
      waDay: [{ day: '2026-11-02', currency: 'INR', amount: 5 }, { day: '2026-11-01', currency: 'INR', amount: 3 }],
      aiDay: [{ day: '2026-11-02', costUsd: 0.5 }, { day: '2026-11-03', costUsd: 0.1 }],
    }))
    expect(r.byDay.map((d) => d.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
    expect(r.byDay[1]).toMatchObject({ whatsapp: { INR: 5 }, aiUsd: 0.5 })
  })
})
