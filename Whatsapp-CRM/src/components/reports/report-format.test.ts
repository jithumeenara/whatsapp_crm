import { describe, expect, it } from 'vitest'
import { compareText } from './report-format'

// The screen's "Before: … · change" line follows the shared rule
// (src/lib/reports/doc/change.ts), so it says what the files say.
describe('compareText on screen', () => {
  const count = { kind: 'count' } as const
  it('2 → 32 is too few to judge, faded, not "+1,500%"', () => {
    expect(compareText({ now: 32, before: 2, higherIsBetter: true, fmt: count })).toEqual({ before: '2', change: 'Too few to judge', state: 'small' })
  })
  it('91 → 1,057 reads "11.6× before"', () => {
    expect(compareText({ now: 1057, before: 91, higherIsBetter: true, fmt: count })).toMatchObject({ change: '11.6× before', state: 'good' })
  })
  it('61.5% → 83.6% is +22.1 points', () => {
    expect(compareText({ now: 83.6, before: 61.5, higherIsBetter: true, fmt: { kind: 'percent' } })).toMatchObject({ change: '+22.1 pts', state: 'good' })
  })
  it('an ordinary change is still a percent, coloured by whether up is good', () => {
    expect(compareText({ now: 142, before: 105, higherIsBetter: true, fmt: count })).toMatchObject({ change: '+35%', state: 'good' })
    expect(compareText({ now: 120, before: 100, higherIsBetter: false, fmt: { kind: 'money', currency: 'INR' } })).toMatchObject({ change: '+20%', state: 'bad' })
  })
})
