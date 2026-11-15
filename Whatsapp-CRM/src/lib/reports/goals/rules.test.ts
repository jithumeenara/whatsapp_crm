import { describe, expect, it } from 'vitest'
import { elapsedShare, goalProgress, validateGoal } from './rules'

const U1 = '11111111-1111-4111-8111-111111111111'
const team = new Map([[U1, 'agent']])

describe('validateGoal', () => {
  it('copies only known fields; the team goal has no person', () => {
    expect(validateGoal({ metric: 'won', period: 'month', target: '50', user_id: null, account_id: 'evil' }, team))
      .toEqual({ ok: true, value: { metric: 'won', period: 'month', target: 50, user_id: null } })
  })
  it('a person must be on this team', () => {
    expect(validateGoal({ metric: 'won', period: 'week', target: 5, user_id: U1 }, team)).toMatchObject({ ok: true, value: { user_id: U1 } })
    expect(validateGoal({ metric: 'won', period: 'week', target: 5, user_id: '22222222-2222-4222-8222-222222222222' }, team)).toMatchObject({ ok: false })
  })
  it('unknown metric or period, zero, negative, huge or a percent over 100 are refused', () => {
    expect(validateGoal({ metric: 'mood', period: 'week', target: 5 }, team)).toMatchObject({ ok: false })
    expect(validateGoal({ metric: 'won', period: 'year', target: 5 }, team)).toMatchObject({ ok: false })
    expect(validateGoal({ metric: 'won', period: 'week', target: 0 }, team)).toMatchObject({ ok: false })
    expect(validateGoal({ metric: 'won', period: 'week', target: -3 }, team)).toMatchObject({ ok: false })
    expect(validateGoal({ metric: 'won', period: 'week', target: 1e12 }, team)).toMatchObject({ ok: false })
    expect(validateGoal({ metric: 'attended_pct', period: 'week', target: 120 }, team)).toMatchObject({ ok: false })
  })
})

describe('elapsedShare', () => {
  it('how much of the running week or month has gone', () => {
    // Week from Monday 00:00; Thursday 00:00 is 3/7 of it.
    expect(elapsedShare('week', '2026-11-16', new Date('2026-11-16T00:00:00Z'), new Date('2026-11-19T00:00:00Z'))).toBeCloseTo(3 / 7, 5)
    // November has 30 days; 15 days in is half.
    expect(elapsedShare('month', '2026-11-01', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-16T00:00:00Z'))).toBeCloseTo(0.5, 5)
  })
})

describe('goalProgress', () => {
  it('a count goal is judged against the pace the time so far allows', () => {
    expect(goalProgress({ metric: 'won', target: 50, actual: 30, elapsed: 0.5 })).toMatchObject({ pct: 60, status: 'on_track' })
    expect(goalProgress({ metric: 'won', target: 50, actual: 15, elapsed: 0.5 })).toMatchObject({ pct: 30, status: 'behind' })
    expect(goalProgress({ metric: 'won', target: 50, actual: 52, elapsed: 0.5 })).toMatchObject({ status: 'done' })
  })
  it('a rate goal (attended %) is met or not, whatever the day', () => {
    expect(goalProgress({ metric: 'attended_pct', target: 60, actual: 64, elapsed: 0.1 })).toMatchObject({ status: 'done' })
    expect(goalProgress({ metric: 'attended_pct', target: 60, actual: 40, elapsed: 0.9 })).toMatchObject({ status: 'behind' })
  })
  it('a wait goal is met when the wait is at or under it', () => {
    expect(goalProgress({ metric: 'first_reply_min', target: 15, actual: 9, elapsed: 0.5 })).toMatchObject({ status: 'done' })
    expect(goalProgress({ metric: 'first_reply_min', target: 15, actual: 40, elapsed: 0.5 })).toMatchObject({ status: 'behind' })
  })
  it('no number yet is no data, never "behind"', () => {
    expect(goalProgress({ metric: 'first_reply_min', target: 15, actual: null, elapsed: 0.5 })).toMatchObject({ status: 'no_data', pct: null })
  })
})
