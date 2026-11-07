import { describe, expect, it } from 'vitest'
import { resolvePeriod } from './period'

const TZ = 'Asia/Kolkata'
// 7 Nov 2026, 20:00 UTC = 8 Nov 2026, 01:30 in Kolkata (a Sunday).
const NOW = new Date('2026-11-07T20:00:00Z')
const iso = (d: Date) => d.toISOString()

describe('report periods, in the business time zone', () => {
  it('"today" is the business day, not the server day, against the same hours yesterday', () => {
    const p = resolvePeriod({ kind: 'today' }, NOW, TZ)!
    expect(p.firstDay).toBe('2026-11-08')
    expect(iso(p.from)).toBe('2026-11-07T18:30:00.000Z')
    expect(iso(p.to)).toBe(iso(NOW))
    expect(iso(p.prevFrom)).toBe('2026-11-06T18:30:00.000Z')
    expect(iso(p.prevTo)).toBe('2026-11-06T20:00:00.000Z')
    expect(p.partial).toBe(true)
  })

  it('"this week" starts on Monday and compares with the same days of last week', () => {
    const p = resolvePeriod({ kind: 'week' }, NOW, TZ)!
    expect(p.firstDay).toBe('2026-11-02')
    expect(iso(p.from)).toBe('2026-11-01T18:30:00.000Z')
    expect(iso(p.prevFrom)).toBe('2026-10-25T18:30:00.000Z')
    expect(p.prevTo.getTime() - p.prevFrom.getTime()).toBe(p.to.getTime() - p.from.getTime())
  })

  it('"this month" on the 8th compares with the first 8 days of last month only', () => {
    const p = resolvePeriod({ kind: 'month' }, NOW, TZ)!
    expect(p.firstDay).toBe('2026-11-01')
    expect(iso(p.prevFrom)).toBe('2026-09-30T18:30:00.000Z')
    expect(iso(p.prevTo)).toBe('2026-10-07T20:00:00.000Z')
  })

  it('late in a long month the comparison stops at the end of the shorter month', () => {
    const p = resolvePeriod({ kind: 'month' }, new Date('2026-03-31T12:00:00Z'), TZ)!
    expect(iso(p.prevTo)).toBe('2026-02-28T18:30:00.000Z') // 1 March 00:00 IST
  })

  it('a finished custom range is whole days, compared with the same number of days before', () => {
    const p = resolvePeriod({ kind: 'custom', from: '2026-10-13', to: '2026-10-26' }, NOW, TZ)!
    expect(iso(p.from)).toBe('2026-10-12T18:30:00.000Z')
    expect(iso(p.to)).toBe('2026-10-26T18:30:00.000Z')
    expect(iso(p.prevFrom)).toBe('2026-09-28T18:30:00.000Z')
    expect(iso(p.prevTo)).toBe('2026-10-12T18:30:00.000Z')
    expect(p.partial).toBe(false)
  })

  it('refuses a range that is reversed, malformed or longer than a year', () => {
    expect(resolvePeriod({ kind: 'custom', from: '2026-10-26', to: '2026-10-13' }, NOW, TZ)).toBeNull()
    expect(resolvePeriod({ kind: 'custom', from: '2026-02-30', to: '2026-03-01' }, NOW, TZ)).toBeNull()
    expect(resolvePeriod({ kind: 'custom', from: '2024-01-01', to: '2026-01-01' }, NOW, TZ)).toBeNull()
  })
})
