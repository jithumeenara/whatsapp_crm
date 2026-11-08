import { describe, it, expect } from 'vitest'
import {
  biggestDropSentence,
  comparisonLabel,
  dealsWithoutAmount,
  followUpHref,
  linkOrText,
  minutesSince,
  periodLabel,
  sourceName,
  topNWithOther,
  winRate,
  type SourceRow,
} from './view-model'

const c = (total: number, won = 0): Pick<SourceRow, 'total' | 'won' | 'lost' | 'closedNoOutcome' | 'open'> => ({
  total, won, lost: 0, closedNoOutcome: 0, open: total - won,
})
const src = (source: string, total: number, won = 0): SourceRow => ({ source, ...c(total, won) })

describe('sourceName', () => {
  it('turns stored source keys into words a person reads', () => {
    expect(sourceName('facebook')).toBe('Facebook')
    expect(sourceName('walk_in')).toBe('Walk in')
    expect(sourceName('api')).toBe('API')
    expect(sourceName('manual')).toBe('Added by hand')
    expect(sourceName('WhatsApp')).toBe('WhatsApp')
    expect(sourceName('whatsapp')).toBe('WhatsApp')
    expect(sourceName('whatsapp_ai')).toBe('WhatsApp (AI)')
    expect(sourceName('chatbot')).toBe('Chatbot')
  })
  it('says Unknown for an empty source', () => {
    expect(sourceName('')).toBe('Unknown')
    expect(sourceName(null)).toBe('Unknown')
  })
})

describe('topNWithOther', () => {
  it('sorts by size and keeps all rows when there are few', () => {
    const out = topNWithOther([src('a', 1), src('b', 5), src('c', 3)], 6)
    expect(out.map((r) => r.source)).toEqual(['b', 'c', 'a'])
  })
  it('folds everything past the top N into Other, summing the counts', () => {
    const rows = [src('a', 10, 5), src('b', 9), src('c', 8), src('d', 3, 1), src('e', 2, 1), src('f', 1)]
    const out = topNWithOther(rows, 3)
    expect(out.map((r) => r.source)).toEqual(['a', 'b', 'c', 'Other'])
    expect(out[3]).toMatchObject({ total: 6, won: 2, open: 4 })
  })
  it('marks the folded bucket so a real source called Other is not mistaken for it', () => {
    const rows = [src('Other', 10), src('b', 9), src('c', 8), src('d', 3), src('e', 2)]
    const out = topNWithOther(rows, 3)
    expect(out.map((r) => r.source)).toEqual(['Other', 'b', 'c', 'Other'])
    expect(out.map((r) => !!r.folded)).toEqual([false, false, false, true])
    expect(topNWithOther([src('Other', 1)], 3)[0].folded).toBeFalsy()
  })
  it('returns an empty list for no rows', () => {
    expect(topNWithOther([], 6)).toEqual([])
  })
})

describe('biggestDropSentence', () => {
  const row = (key: string, label: string, count: number, outcome: 'open' | 'won' | 'lost' = 'open') =>
    ({ key, label, outcome, count }) as never
  it('names the two neighbouring stages with the biggest loss', () => {
    const s = biggestDropSentence([row('a', 'Enquiry', 100), row('b', 'Contacted', 90), row('c', 'Qualified', 30), row('d', 'Won', 20, 'won')])
    expect(s).toContain('Contacted')
    expect(s).toContain('Qualified')
    expect(s).toContain('60')
  })
  it('ignores lost stages and says nothing when nothing drops', () => {
    expect(biggestDropSentence([row('a', 'Enquiry', 5), row('b', 'Won', 5, 'won'), row('x', 'Lost', 0, 'lost')])).toBeNull()
  })
  it('needs two stages', () => {
    expect(biggestDropSentence([row('a', 'Enquiry', 5)])).toBeNull()
    expect(biggestDropSentence([])).toBeNull()
  })
})

describe('winRate', () => {
  it('is won over total, to one decimal', () => {
    expect(winRate({ ...c(184, 31) }, 20).pct).toBe(16.8)
  })
  it('fades when fewer leads than the small-number rule', () => {
    expect(winRate({ ...c(10, 5) }, 20)).toEqual({ pct: 50, faded: true })
    expect(winRate({ ...c(20, 5) }, 20).faded).toBe(false)
  })
  it('has no percentage with no leads', () => {
    expect(winRate({ ...c(0, 0) }, 20)).toEqual({ pct: null, faded: true })
  })
})

describe('dealsWithoutAmount', () => {
  it('adds up deals minus deals with an amount, across currencies', () => {
    expect(dealsWithoutAmount([
      { currency: 'INR', amount: 100, deals: 62, withAmount: 53 },
      { currency: 'USD', amount: 5, deals: 3, withAmount: 2 },
    ])).toBe(10)
  })
  it('is zero for null or empty', () => {
    expect(dealsWithoutAmount(null)).toBe(0)
    expect(dealsWithoutAmount([])).toBe(0)
  })
})

describe('comparisonLabel', () => {
  it('says same days when the period is not over', () => {
    expect(comparisonLabel('month', true)).toBe('vs same days last month')
    expect(comparisonLabel('week', true)).toBe('vs same days last week')
  })
  it('compares whole periods once over', () => {
    expect(comparisonLabel('month', false)).toBe('vs last month')
    expect(comparisonLabel('today', false)).toBe('vs yesterday')
    expect(comparisonLabel('today', true)).toBe('vs yesterday')
  })
})

describe('linkOrText', () => {
  it('owner and admin may open every page, with or without a list', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(linkOrText('/reports', role, null)).toBe('/reports')
      expect(linkOrText('/pipelines', role, ['/leads'])).toBe('/pipelines')
    }
  })
  it('supervisor gets the role default (everything) with no list, and obeys an explicit one', () => {
    expect(linkOrText('/reports', 'supervisor', null)).toBe('/reports')
    expect(linkOrText('/reports?x=1', 'supervisor', ['/leads'])).toBeNull()
    expect(linkOrText('/leads?tab=all', 'supervisor', ['/leads'])).toBe('/leads?tab=all')
  })
  it('agent and viewer with no list get no link to admin-only pages', () => {
    for (const role of ['agent', 'viewer'] as const) {
      expect(linkOrText('/reports', role, null)).toBeNull()
      expect(linkOrText('/pipelines', role, null)).toBeNull()
      expect(linkOrText('/leads?tab=mine', role, null)).toBe('/leads?tab=mine')
    }
  })
  it('an explicit list wins for an agent, and an empty list closes everything', () => {
    expect(linkOrText('/reports', 'agent', ['/reports'])).toBe('/reports')
    expect(linkOrText('/leads', 'agent', [])).toBeNull()
  })
  it('an unknown role gets plain text', () => {
    expect(linkOrText('/leads', null, null)).toBeNull()
  })
})

describe('minutesSince', () => {
  it('is the gap in minutes', () => {
    expect(minutesSince(10 * 60000, 4 * 60000)).toBe(6)
  })
  it('never goes negative when the browser clock is behind the server', () => {
    expect(minutesSince(0, 3 * 60000)).toBe(0)
  })
  it('is 0 for a missing time', () => {
    expect(minutesSince(1000, Number.NaN)).toBe(0)
  })
})

describe('periodLabel', () => {
  it('names the period in words', () => {
    expect(periodLabel('today')).toBe('Today')
    expect(periodLabel('week')).toBe('This week')
    expect(periodLabel('month')).toBe('This month')
  })
})

describe('followUpHref', () => {
  it('agent links open their own list', () => {
    expect(followUpHref('overdue', 'agent')).toBe('/follow-ups?due=overdue&mine=1')
    expect(followUpHref('next7', 'agent')).toBe('/follow-ups?due=next7&mine=1')
  })
  it('owner and team links do not narrow', () => {
    expect(followUpHref('today', 'owner')).toBe('/follow-ups?due=today')
    expect(followUpHref('today', 'team')).toBe('/follow-ups?due=today')
  })
})
