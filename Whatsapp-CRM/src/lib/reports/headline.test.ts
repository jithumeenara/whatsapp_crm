import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { actions, change, formatMoney, headline } from './headline'
import { tally, type ReportSummary } from './summary'

const leak = (count = 0) => ({ count, rows: [] })
function summary(over: Partial<ReportSummary> = {}): ReportSummary {
  return {
    generatedAt: '', scope: 'team',
    cohort: { total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0 },
    previousCohort: { total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0 },
    excluded: 0, wonInPeriod: 0, lostInPeriod: 0, previousWonInPeriod: 0,
    calls: { total: 0, connected: 0, previousTotal: 0, countedSince: null },
    revenue: [], previousRevenue: [], lostAmount: [], pipeline: [], pipelineByStage: [], wonWithoutDate: 0,
    bySource: [], byCategory: [], lostReasons: [],
    leaks: { neverContacted: leak(), overdueFollowUps: leak(), unassigned: leak(), waitingChats: leak() },
    leakHours: 24, agents: [], funnel: [],
    ...over,
  }
}

describe('cohort tally', () => {
  it('won + lost + closed without outcome + open always adds up to the total', () => {
    const c = tally([
      { status: 'closed', converted_at: new Date(), lost_reason: null },
      { status: 'closed', converted_at: null, lost_reason: 'Price' },
      { status: 'closed', converted_at: null, lost_reason: null },
      { status: 'follow_up', converted_at: null, lost_reason: null },
      { status: 'new', converted_at: null, lost_reason: null },
    ])
    expect(c).toEqual({ total: 5, won: 1, lost: 1, closedNoOutcome: 1, open: 2 })
    expect(c.won + c.lost + c.closedNoOutcome + c.open).toBe(c.total)
  })
})

describe('report words', () => {
  it('says what happened in one sentence, with the money', () => {
    const s = summary({ cohort: { total: 160, won: 10, lost: 20, closedNoOutcome: 0, open: 130 }, wonInPeriod: 12, revenue: [{ currency: 'INR', amount: 2406270, deals: 12, withAmount: 12 }], leaks: { neverContacted: leak(40), overdueFollowUps: leak(), unassigned: leak(), waitingChats: leak() } })
    expect(headline(s, 'this week')).toBe('160 leads came in this week, 12 won, ₹24,06,270 earned. 40 leads have not been contacted yet.')
  })

  it('an empty period says so instead of printing zeros', () => {
    expect(headline(summary(), 'today')).toBe('No new leads today yet.')
  })

  it('suggests at most three actions, biggest first, and none when nothing leaks', () => {
    expect(actions(summary())).toEqual([])
    const s = summary({
      cohort: { total: 10, won: 0, lost: 0, closedNoOutcome: 2, open: 8 },
      leaks: { neverContacted: leak(5), overdueFollowUps: leak(9), unassigned: leak(1), waitingChats: leak(3) },
    })
    expect(actions(s).map((a) => a.key)).toEqual(['followups', 'never', 'chats'])
  })

  it('compares only when there is something to compare with', () => {
    expect(change(12, 10)).toBe(20)
    expect(change(5, 0)).toBeNull()
  })

  it('formats money in the deal currency', () => {
    expect(formatMoney({ currency: 'INR', amount: 1783965, deals: 4, withAmount: 4 })).toBe('₹17,83,965')
    expect(formatMoney({ currency: 'XX1', amount: 10, deals: 1, withAmount: 1 })).toBe('XX1 10')
  })
})
