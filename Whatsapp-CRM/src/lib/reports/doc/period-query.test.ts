import { describe, expect, it } from 'vitest'
import { lastYear, rangeFor, resolveQuery } from './period-query'

const TZ = 'Asia/Kolkata'
// Saturday 15 Nov 2026, 10:00 in Kolkata.
const NOW = new Date('2026-11-15T04:30:00Z')

describe('rangeFor', () => {
  it('finished periods are whole days in the business zone', () => {
    expect(rangeFor('yesterday', '2026-11-15')).toEqual({ from: '2026-11-14', to: '2026-11-14' })
    expect(rangeFor('last_week', '2026-11-15')).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(rangeFor('last_month', '2026-11-15')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(rangeFor('last_7', '2026-11-15')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    expect(rangeFor('last_30', '2026-11-15')).toEqual({ from: '2026-10-17', to: '2026-11-15' })
    expect(rangeFor('year', '2026-11-15')).toEqual({ from: '2026-01-01', to: '2026-11-15' })
    expect(rangeFor('last_month', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('lastYear', () => {
  it('same day a year back; 29 Feb becomes 28 Feb', () => {
    expect(lastYear('2026-11-15')).toBe('2025-11-15')
    expect(lastYear('2028-02-29')).toBe('2027-02-28')
  })
})

describe('resolveQuery', () => {
  it('defaults to this week against the same days last week', () => {
    const r = resolveQuery({}, NOW, TZ)!
    expect(r.kind).toBe('week')
    expect(r.compare).toBe('previous')
    expect(r.period.firstDay).toBe('2026-11-09')
    expect(r.previousDays).toEqual({ firstDay: '2026-11-02', lastDay: '2026-11-08' })
  })

  it('last week is a whole week, compared with the week before', () => {
    const r = resolveQuery({ period: 'last_week' }, NOW, TZ)!
    expect(r.period.firstDay).toBe('2026-11-02')
    expect(r.period.lastDay).toBe('2026-11-08')
    expect(r.period.partial).toBe(false)
    expect(r.previousDays).toEqual({ firstDay: '2026-10-26', lastDay: '2026-11-01' })
  })

  it('last month is compared with the month before it', () => {
    const r = resolveQuery({ period: 'last_month' }, NOW, TZ)!
    expect(r.previousDays).toEqual({ firstDay: '2026-09-01', lastDay: '2026-09-30' })
  })

  it('vs last year shifts the window a year back, same elapsed part', () => {
    const r = resolveQuery({ period: 'month', compare: 'year' }, NOW, TZ)!
    expect(r.previousDays).toEqual({ firstDay: '2025-11-01', lastDay: '2025-11-15' })
    expect(r.period.prevTo.getTime() - r.period.prevFrom.getTime()).toBe(r.period.to.getTime() - r.period.from.getTime())
  })

  it('no comparison leaves an empty window, so nothing is counted "before"', () => {
    const r = resolveQuery({ period: 'today', compare: 'none' }, NOW, TZ)!
    expect(r.previousDays).toBeNull()
    expect(r.period.prevTo.getTime()).toBe(r.period.prevFrom.getTime())
  })

  it('bad dates are refused; unknown words fall back to safe defaults', () => {
    expect(resolveQuery({ period: 'custom', from: '2026-11-10', to: '2026-11-01' }, NOW, TZ)).toBeNull()
    expect(resolveQuery({ period: 'custom', from: '2026-12-01', to: '2026-12-05' }, NOW, TZ)).toBeNull()
    expect(resolveQuery({ period: 'decade', compare: 'mars' }, NOW, TZ)).toMatchObject({ kind: 'week', compare: 'previous' })
  })
})
