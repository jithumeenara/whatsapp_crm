import { describe, expect, it } from 'vitest'
import { marketForNumber, priceMessage, rateCardFor } from './rate-card'

const AFTER = new Date('2026-11-09T10:00:00Z')

describe('marketForNumber: the market Meta prices a recipient in', () => {
  it('finds India, with or without a plus, spaces or 00', () => {
    for (const n of ['919188318031', '+91 91883 18031', '00919188318031']) {
      expect(marketForNumber(n)).toEqual({ market: 'India', iso: 'IN' })
    }
  })

  it('puts the US and Canada in North America', () => {
    expect(marketForNumber('14155550123').market).toBe('North America')
    expect(marketForNumber('16045550123').market).toBe('North America')
  })

  it('tells Kazakhstan from Russia, which share +7', () => {
    expect(marketForNumber('77011234567').market).toBe('Kazakhstan')
    expect(marketForNumber('79161234567').market).toBe('Russia')
  })

  it('does not call a US number Canadian: +1 is shared, so no single country is claimed', () => {
    expect(marketForNumber('14155550123')).toEqual({ market: 'North America', iso: null })
    expect(marketForNumber('16045550123')).toEqual({ market: 'North America', iso: null })
  })

  it('uses the area prefix: the Dominican Republic is not North America', () => {
    expect(marketForNumber('18095551234').market).toBe('Rest of Latin America')
    expect(marketForNumber('17875551234').market).toBe('Rest of Latin America') // Puerto Rico
  })

  it('maps a country Meta does not list to Other, and junk to Other', () => {
    expect(marketForNumber('99999999999').market).toBe('Other')
    expect(marketForNumber('').market).toBe('Other')
    expect(marketForNumber('not a number').market).toBe('Other')
  })
})

describe('rateCardFor: only a card Meta published', () => {
  it('has the INR card and nothing else', () => {
    expect(rateCardFor('INR')?.effectiveFrom).toBe('2026-10-01')
    expect(rateCardFor('inr')?.effectiveFrom).toBe('2026-10-01')
    expect(rateCardFor('USD')).toBeNull()
    expect(rateCardFor('')).toBeNull()
  })
})

describe('priceMessage', () => {
  const base = { currency: 'INR', recipient: '919188318031', at: AFTER }

  it('prices a delivered marketing template to India at Meta\'s INR rate', () => {
    const p = priceMessage({ ...base, category: 'marketing', type: 'regular' })
    expect(p).toMatchObject({ rateKnown: true, market: 'India', amount: '0.863100' })
  })

  it('prices utility, authentication and service for India at 0.115', () => {
    for (const category of ['utility', 'authentication', 'service']) {
      expect(priceMessage({ ...base, category, type: 'regular' }).amount).toBe('0.115000')
    }
  })

  it('charges nothing for the free types, and says it is free, not unknown', () => {
    for (const type of ['free_customer_service', 'free_entry_point', 'free_group_customer_service']) {
      const p = priceMessage({ ...base, category: 'utility', type })
      expect(p).toMatchObject({ amount: '0.000000', rateKnown: true })
    }
    expect(priceMessage({ ...base, category: 'referral_conversion', type: 'regular' }).amount).toBe('0.000000')
  })

  it('does not invent a price for a currency it has no card for', () => {
    const p = priceMessage({ ...base, currency: 'USD', category: 'marketing', type: 'regular' })
    expect(p).toMatchObject({ amount: null, rateKnown: false })
  })

  it('does not apply today\'s card to a message from before it took effect', () => {
    const p = priceMessage({ ...base, at: new Date('2026-09-30T10:00:00Z'), category: 'marketing', type: 'regular' })
    expect(p).toMatchObject({ amount: null, rateKnown: false })
  })

  it("prices Marketing Messages Lite as marketing: Meta's card says marketing rates apply to both", () => {
    const p = priceMessage({ ...base, category: 'marketing_lite', type: 'regular' })
    expect(p).toMatchObject({ amount: '0.863100', rateKnown: true })
  })

  it('does not guess an unknown category', () => {
    const p = priceMessage({ ...base, category: 'something_new', type: 'regular' })
    expect(p).toMatchObject({ amount: null, rateKnown: false })
  })

  it('uses the international authentication rate only when Meta says so', () => {
    const p = priceMessage({ ...base, category: 'authentication-international', type: 'regular' })
    expect(p.amount).toBe('2.497100')
    // a market with no international rate: unknown, not the ordinary rate
    const us = priceMessage({ ...base, recipient: '14155550123', category: 'authentication-international', type: 'regular' })
    expect(us).toMatchObject({ amount: null, rateKnown: false })
  })

  it('keeps a sum of many small charges exact', () => {
    // Whole micro-rupees add exactly; floating rupees would drift.
    let micros = 0
    for (let i = 0; i < 10000; i++) {
      const p = priceMessage({ ...base, category: 'utility', type: 'regular' })
      micros += Math.round(Number(p.amount) * 1_000_000)
    }
    expect(micros).toBe(1_150_000_000) // 10,000 x 0.115 = 1,150 rupees exactly
  })
})
