import { describe, expect, it } from 'vitest'
import { spendTable } from './spend'

const c = (source: string, total: number, won: number) => ({ source, total, won, lost: 0, closedNoOutcome: 0, open: total - won })
const s = (source: string, amount: number, month = '2026-11', currency = 'INR') => ({ month, source, amount, currency })

describe('spendTable', () => {
  it('divides the month’s spend by the leads and wins from the same source', () => {
    const rows = spendTable([c('facebook', 40, 4)], [s('Facebook', 20000)], '2026-11')
    expect(rows).toEqual([
      { source: 'facebook', currency: 'INR', spend: 20000, leads: 40, won: 4, costPerLead: 500, costPerWin: 5000 },
    ])
  })

  it('matches a typed spend name to the stored key whatever the case, spaces or underscores', () => {
    const rows = spendTable([c('walk_in', 10, 1)], [s('Walk in', 1000)], '2026-11')
    expect(rows[0]).toMatchObject({ source: 'walk_in', spend: 1000, leads: 10, costPerLead: 100 })
  })

  it('uses only the asked month, and adds two rows of the same source and currency', () => {
    const rows = spendTable([c('google', 5, 0)], [s('google', 300), s('google', 200), s('google', 9999, '2026-10')], '2026-11')
    expect(rows[0]).toMatchObject({ spend: 500, leads: 5, costPerLead: 100, costPerWin: null })
  })

  it('keeps currencies apart: rupees and dollars are never added', () => {
    const rows = spendTable([c('facebook', 10, 2)], [s('facebook', 1000, '2026-11', 'INR'), s('facebook', 50, '2026-11', 'USD')], '2026-11')
    expect(rows.map((r) => [r.currency, r.spend])).toEqual([['INR', 1000], ['USD', 50]])
  })

  it('shows spend with no leads (money spent, nothing came in) and leads with no spend', () => {
    const rows = spendTable([c('referral', 7, 3)], [s('instagram', 4000)], '2026-11')
    expect(rows).toContainEqual({ source: 'instagram', currency: 'INR', spend: 4000, leads: 0, won: 0, costPerLead: null, costPerWin: null })
    expect(rows).toContainEqual({ source: 'referral', currency: null, spend: null, leads: 7, won: 3, costPerLead: null, costPerWin: null })
  })

  it('puts the biggest spend first, then sources with no spend by leads', () => {
    const rows = spendTable([c('a', 1, 0), c('b', 9, 0), c('fb', 3, 0)], [s('fb', 10), s('google', 500)], '2026-11')
    expect(rows.map((r) => r.source)).toEqual(['google', 'fb', 'b', 'a'])
  })

  it('handles nothing at all', () => {
    expect(spendTable([], [], '2026-11')).toEqual([])
  })
})
