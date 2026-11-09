import { describe, expect, it } from 'vitest'
import { easeOutCubic, prefersReducedMotion, valueAt } from './count-up'

describe('easeOutCubic', () => {
  it('starts at 0, ends at 1, never goes backwards, and is quick at first', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 20; i++) {
      const v = easeOutCubic(i / 20)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('stays inside 0..1 whatever it is given', () => {
    expect(easeOutCubic(-3)).toBe(0)
    expect(easeOutCubic(7)).toBe(1)
    expect(easeOutCubic(Number.NaN)).toBe(1)
  })
})

describe('valueAt', () => {
  it('runs from the start to the target and lands exactly on it', () => {
    expect(valueAt(0, 100, 0)).toBe(0)
    expect(valueAt(0, 100, 1)).toBe(100)
    expect(valueAt(0, 100, 0.5)).toBeGreaterThan(50)
    expect(valueAt(10, 10, 0.3)).toBe(10)
  })

  it('works downwards and for fractions (paise)', () => {
    expect(valueAt(100, 0, 1)).toBe(0)
    expect(valueAt(0, 0.8631, 1)).toBe(0.8631)
  })
})

describe('prefersReducedMotion', () => {
  const win = (matches: boolean) => ({ matchMedia: (q: string) => ({ matches: q.includes('reduce') && matches }) })

  it('is true when the person asked their device for less motion', () => {
    expect(prefersReducedMotion(win(true))).toBe(true)
  })

  it('is false when they did not, and when there is no way to ask (server, old browser)', () => {
    expect(prefersReducedMotion(win(false))).toBe(false)
    expect(prefersReducedMotion(undefined)).toBe(false)
    expect(prefersReducedMotion({})).toBe(false)
  })
})
