import { describe, expect, it } from 'vitest'
import { changeLabel, judgeChange } from './change'

// Bug: "Messages sent 1,057 — Before: 91 · +1062%" and "Leads 32 — Before:
// 2 · +1,500%". A percentage of a tiny base says nothing, and the screen,
// PDF, slides and Excel each worked the change out differently (PDF said
// "+36%" for 61.5% → 83.6%, which is 22.1 points).

const count = { kind: 'count' } as const
const pctF = { kind: 'percent' } as const
const money = { kind: 'money', currency: 'INR' } as const
const c = (now: number | null, before: number | null, fmt: { kind: string; currency?: string } = count, o: { small?: boolean; higherIsBetter?: boolean } = {}) =>
  ({ now, before, fmt: fmt as never, higherIsBetter: o.higherIsBetter ?? true, small: o.small })

describe('judgeChange', () => {
  it('a count from a small base is too few to judge, whatever it grew to', () => {
    expect(judgeChange(c(32, 2)).kind).toBe('small')
    expect(judgeChange(c(1057, 9)).kind).toBe('small')
    expect(judgeChange(c(3, 0)).kind).toBe('small')
    expect(judgeChange(c(32, 2)).tone).toBeNull()
  })

  it('more than four times the base reads as "N× before", never a four-digit percent', () => {
    const ch = judgeChange(c(1057, 91))
    expect(ch).toMatchObject({ kind: 'times', tone: 'good' })
    expect(changeLabel(ch, String)).toBe('11.6× before')
  })

  it('an ordinary change is a percent, one decimal under 10%', () => {
    expect(changeLabel(judgeChange(c(142, 105)), String)).toBe('+35%')
    expect(changeLabel(judgeChange(c(100, 95)), String)).toBe('+5.3%')
    expect(changeLabel(judgeChange(c(50, 100)), String)).toBe('−50%')
  })

  it('a percentage changes in points', () => {
    const ch = judgeChange(c(83.6, 61.5, pctF))
    expect(ch.kind).toBe('pts')
    expect(changeLabel(ch, String)).toBe('+22.1 pts')
  })

  it('money from zero shows the amount it moved', () => {
    const ch = judgeChange(c(500, 0, money))
    expect(ch.kind).toBe('abs')
    expect(changeLabel(ch, (v) => `₹${v}`)).toBe('+₹500')
  })

  it('a fall that is good (cost) is green; no change is neutral', () => {
    expect(judgeChange(c(80, 100, money, { higherIsBetter: false })).tone).toBe('good')
    expect(judgeChange(c(100, 100)).tone).toBeNull()
    expect(changeLabel(judgeChange(c(100, 100)), String)).toBe('±0%')
  })

  it('a builder-flagged small comparison stays small; nothing to compare is none', () => {
    expect(judgeChange(c(90, 70, count, { small: true })).kind).toBe('small')
    expect(judgeChange(c(null, 5)).kind).toBe('none')
    expect(judgeChange(c(5, null)).kind).toBe('none')
    expect(changeLabel(judgeChange(c(5, null)), String)).toBeNull()
  })

  it('too few has its own words, which callers may translate', () => {
    expect(changeLabel(judgeChange(c(32, 2)), String)).toBe('Too few to judge')
    expect(changeLabel(judgeChange(c(32, 2)), String, { tooFew: 'കുറവ്', times: (n) => `${n}×` })).toBe('കുറവ്')
  })
})

describe('judgeChange: waits under a minute', () => {
  it('two waits both under a minute are too small to compare (0.5 → 0.2 min is not "−62%")', () => {
    const minutes = { kind: 'minutes' } as const
    expect(judgeChange({ now: 0.2, before: 0.5, higherIsBetter: false, fmt: minutes }).kind).toBe('small')
    expect(judgeChange({ now: 30, before: 0.5, higherIsBetter: false, fmt: minutes }).kind).not.toBe('small')
  })
})
