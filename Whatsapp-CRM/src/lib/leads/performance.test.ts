import { describe, it, expect } from 'vitest'
import { summarise, NOT_CONNECTED_STATUS, type StageChange } from './performance'

const change = (newStatus: string | null, leadId: string | null = 'lead-1'): StageChange => ({
  newStatus,
  leadId,
})

describe('summarise', () => {
  it('counts a call that nobody answered as an attempt, not a failure to try', () => {
    const p = summarise({
      picked: 5,
      stageChanges: [
        change(NOT_CONNECTED_STATUS),
        change(NOT_CONNECTED_STATUS),
        change('visited'),
      ],
      won: 0,
      lost: 0,
    })
    expect(p.attempted).toBe(3)
    expect(p.missed).toBe(2)
    expect(p.reached).toBe(1)
  })

  it('treats every status but one as somebody answering', () => {
    // There is a single "nobody picked up" status. Visited, appointment
    // fixed, follow-up and closed all describe a conversation that
    // happened — a list of "connected" statuses would have to be kept
    // in step with the app's own and would drift.
    const p = summarise({
      picked: 0,
      stageChanges: ['visited', 'appointment_fixed', 'follow_up', 'closed'].map((s) => change(s)),
      won: 0,
      lost: 0,
    })
    expect(p.reached).toBe(4)
    expect(p.missed).toBe(0)
  })

  it('separates attempts from people', () => {
    // One lead rung four times is four attempts and one person. Showing
    // only the first makes a persistent agent look busy; only the
    // second makes them look idle.
    const p = summarise({
      picked: 1,
      stageChanges: [
        change(NOT_CONNECTED_STATUS, 'a'),
        change(NOT_CONNECTED_STATUS, 'a'),
        change(NOT_CONNECTED_STATUS, 'a'),
        change('visited', 'a'),
        change('visited', 'b'),
      ],
      won: 0,
      lost: 0,
    })
    expect(p.attempted).toBe(5)
    expect(p.leadsWorked).toBe(2)
  })

  describe('the percentages, which are where this goes wrong', () => {
    it('is null rather than zero when nobody has been rung', () => {
      // 0% reads as "never gets through". A new agent on their first
      // morning has not failed at anything.
      const p = summarise({ picked: 3, stageChanges: [], won: 0, lost: 0 })
      expect(p.reachedPct).toBeNull()
      expect(p.conversionPct).toBeNull()
    })

    it('is null rather than zero when nothing has closed', () => {
      const p = summarise({
        picked: 4,
        stageChanges: [change('visited'), change('follow_up')],
        won: 0,
        lost: 0,
      })
      expect(p.reachedPct).toBe(100)
      expect(p.conversionPct).toBeNull()
    })

    it('rounds rather than floors', () => {
      // 2 of 3 is 67%. Showing 66% to somebody who can do the division
      // costs more trust than the percentage point is worth.
      const p = summarise({
        picked: 0,
        stageChanges: [change('visited'), change('visited'), change(NOT_CONNECTED_STATUS)],
        won: 2,
        lost: 1,
      })
      expect(p.reachedPct).toBe(67)
      expect(p.conversionPct).toBe(67)
    })

    it('measures conversion against what closed, not what was picked', () => {
      // 20 picked, 2 closed of which 1 won is a 50% conversion, not 5%.
      // Leads still being worked are not losses yet, and counting them
      // as such punishes an agent for having a full pipeline.
      const p = summarise({ picked: 20, stageChanges: [], won: 1, lost: 1 })
      expect(p.conversionPct).toBe(50)
    })

    it('reaches 100 and 0 honestly', () => {
      expect(summarise({ picked: 0, stageChanges: [change('visited')], won: 1, lost: 0 }).conversionPct).toBe(100)
      expect(summarise({ picked: 0, stageChanges: [change('visited')], won: 0, lost: 1 }).conversionPct).toBe(0)
      expect(summarise({ picked: 0, stageChanges: [change(NOT_CONNECTED_STATUS)], won: 0, lost: 0 }).reachedPct).toBe(0)
    })
  })

  it('survives a stage change with no status recorded', () => {
    // metadata is free-form JSON. A row written before the field
    // existed, or by something that forgot it, must count as an attempt
    // rather than crash the dashboard — and an unknown outcome is not
    // "nobody answered".
    const p = summarise({
      picked: 0,
      stageChanges: [change(null), change(null, null)],
      won: 0,
      lost: 0,
    })
    expect(p.attempted).toBe(2)
    expect(p.missed).toBe(0)
    expect(p.reached).toBe(2)
    // Two attempts, but only one of them names a lead — an activity
    // with no lead_id is not a person who was rung, and counting it
    // would inflate the figure with rows that identify nobody.
    expect(p.leadsWorked).toBe(1)
  })

  it('reports a quiet week as quiet, not as an error', () => {
    const p = summarise({ picked: 0, stageChanges: [], won: 0, lost: 0 })
    expect(p).toMatchObject({
      picked: 0,
      attempted: 0,
      reached: 0,
      missed: 0,
      won: 0,
      lost: 0,
      leadsWorked: 0,
      reachedPct: null,
      conversionPct: null,
    })
  })
})
