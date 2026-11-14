import { describe, expect, it } from 'vitest'
import { categoryRows, conversions, daysBetween } from './presentation'
import { totalsFromRow } from '@/lib/ads/insights'

describe('daysBetween', () => {
  it('lists every day inclusive, across a month end, and refuses junk', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(daysBetween('2026-11-02', '2026-11-01')).toEqual([])
    expect(daysBetween('x', '2026-11-01')).toEqual([])
  })
})

describe('categoryRows', () => {
  const days = ['2026-10-06', '2026-10-07']
  it('one row per category, day columns, totals, shares, biggest first; blank category grouped', () => {
    const r = categoryRows([
      { label: 'Neuro', day: '2026-10-06', n: 1 },
      { label: 'Varicose Vein', day: '2026-10-06', n: 5 },
      { label: 'Varicose Vein', day: '2026-10-07', n: 3 },
      { label: '', day: '2026-10-07', n: 1 },
      { label: 'Ignored', day: '2026-09-01', n: 9 },
    ], days, '')
    expect(r.total).toBe(10)
    expect(r.dayTotals).toEqual([6, 4])
    expect(r.rows[0]).toEqual({ label: 'Varicose Vein', byDay: [5, 3], total: 8, share: 80 })
    expect(r.rows.map((x) => x.label)).toEqual(['Varicose Vein', '', 'Neuro'])
  })

  it('nothing in, nothing out', () => {
    expect(categoryRows([], days, '')).toEqual({ rows: [], dayTotals: [0, 0], total: 0 })
  })
})

describe('conversions', () => {
  const stages = [
    { key: 'a', label: 'Appointment', outcome: 'open' as const },
    { key: 'v', label: 'Visited', outcome: 'open' as const },
    { key: 'x', label: 'Not interested', outcome: 'lost' as const },
    { key: 's', label: 'Surgery', outcome: 'won' as const },
  ]
  const row = (key: string, count: number) => ({ ...stages.find((s) => s.key === key)!, count })
  it('stage to stage along the open path, skipping lost stages, against the period before', () => {
    const c = conversions(stages, [row('a', 34), row('v', 30), row('s', 11)], [row('a', 24), row('v', 20), row('s', 0)])
    expect(c).toEqual([
      { from: 'Appointment', to: 'Visited', rate: 88.2, previousRate: 83.3 },
      { from: 'Visited', to: 'Surgery', rate: 36.7, previousRate: 0 },
    ])
  })

  it('no one at a stage means no rate, not a division by zero', () => {
    expect(conversions(stages, [], [])[0]).toEqual({ from: 'Appointment', to: 'Visited', rate: null, previousRate: null })
  })
})

describe('totalsFromRow', () => {
  it('reads Meta\'s strings as numbers and refuses a bad currency', () => {
    expect(totalsFromRow({ spend: '8210.5', reach: '80173', impressions: '146592', clicks: '1449', frequency: '1.8284', account_currency: 'INR' }))
      .toEqual({ spend: 8210.5, reach: 80173, impressions: 146592, clicks: 1449, frequency: 1.83, currency: 'INR' })
    expect(totalsFromRow(undefined)).toEqual({ spend: 0, reach: 0, impressions: 0, clicks: 0, frequency: null, currency: null })
    expect(totalsFromRow({ account_currency: '<b>' }).currency).toBeNull()
  })
})
