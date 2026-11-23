import { describe, expect, it } from 'vitest'
import { cleanTaxPercent, toDisplayAmount } from './cost-display'

/** Tax touches money: only 0–100 with two decimals is accepted, and the total is exact. */
describe('cleanTaxPercent', () => {
  it('accepts 0 to 100 with at most two decimals', () => {
    expect(cleanTaxPercent(18)).toBe(18)
    expect(cleanTaxPercent('18')).toBe(18)
    expect(cleanTaxPercent(0)).toBe(0)
    expect(cleanTaxPercent(100)).toBe(100)
    expect(cleanTaxPercent(12.75)).toBe(12.75)
  })
  it('rejects everything else', () => {
    for (const bad of [-1, 100.01, 18.123, 'abc', null, undefined, Infinity, '', NaN]) expect(cleanTaxPercent(bad)).toBeNull()
  })
})

describe('toDisplayAmount (what the business pays)', () => {
  it('usage price × (1 + tax) × rate', () => {
    // $10 of usage, 18% GST, ₹88.5 per dollar = ₹1,044.30
    expect(toDisplayAmount(10, { rate: 88.5, taxPercent: 18 })).toBeCloseTo(1044.3, 6)
  })
  it('no tax and no rate: the USD price unchanged', () => {
    expect(toDisplayAmount(3.25, { rate: null, taxPercent: 0 })).toBe(3.25)
  })
})
