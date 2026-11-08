import { describe, expect, it } from 'vitest'
import {
  formatDueTime,
  lateLabel,
  parseCallsParams,
  parseDueFilter,
  parseTaskGroup,
  showingLabel,
  summaryLine,
  todayWindow,
  waitingLabel,
} from './my-tasks-view'

const NOW = new Date('2026-11-08T10:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const H = 60 * MIN
const D = 24 * H

describe('lateLabel', () => {
  it('says minutes under an hour', () => {
    expect(lateLabel(ago(5 * MIN), NOW)).toBe('5 min late')
  })
  it('says at least 1 min, never 0', () => {
    expect(lateLabel(ago(10_000), NOW)).toBe('1 min late')
  })
  it('says hours under a day', () => {
    expect(lateLabel(ago(2 * H + 10 * MIN), NOW)).toBe('2 h late')
  })
  it('says days from 24 hours', () => {
    expect(lateLabel(ago(3 * D + 2 * H), NOW)).toBe('3 days late')
    expect(lateLabel(ago(D), NOW)).toBe('1 day late')
  })
  it('gives an empty string for a missing or bad date or a future one', () => {
    expect(lateLabel(null, NOW)).toBe('')
    expect(lateLabel('nope', NOW)).toBe('')
    expect(lateLabel(new Date(NOW.getTime() + H).toISOString(), NOW)).toBe('')
  })
})

describe('waitingLabel', () => {
  it('says how long a lead has waited', () => {
    expect(waitingLabel(ago(40 * MIN), NOW)).toBe('Waiting 40 min')
    expect(waitingLabel(ago(3 * H), NOW)).toBe('Waiting 3 h')
    expect(waitingLabel(ago(2 * D), NOW)).toBe('Waiting 2 days')
  })
  it('is empty without a date', () => {
    expect(waitingLabel(undefined, NOW)).toBe('')
  })
})

describe('formatDueTime', () => {
  it('shows the time in the business zone, not the browser zone', () => {
    // 11:00 UTC is 4:30 pm in Kolkata (UTC+5:30).
    expect(formatDueTime('2026-11-08T11:00:00.000Z', 'Asia/Kolkata')).toBe('4:30 pm')
    expect(formatDueTime('2026-11-08T11:00:00.000Z', 'America/New_York')).toBe('6:00 am')
  })
  it('falls back to Kolkata for an unknown zone and is empty for a bad date', () => {
    expect(formatDueTime('2026-11-08T11:00:00.000Z', 'Not/AZone')).toBe('4:30 pm')
    expect(formatDueTime(null, 'Asia/Kolkata')).toBe('')
    expect(formatDueTime('x', 'Asia/Kolkata')).toBe('')
  })
})

describe('parseTaskGroup', () => {
  it('accepts the three groups only', () => {
    expect(parseTaskGroup('overdue')).toBe('overdue')
    expect(parseTaskGroup('today')).toBe('today')
    expect(parseTaskGroup('new')).toBe('new')
    expect(parseTaskGroup('all')).toBeNull()
    expect(parseTaskGroup('')).toBeNull()
    expect(parseTaskGroup(null)).toBeNull()
  })
})

describe('summaryLine', () => {
  it('keeps the two numbers apart', () => {
    expect(summaryLine(12, 5)).toBe('12 open leads · 5 pending follow-ups')
    expect(summaryLine(1, 1)).toBe('1 open lead · 1 pending follow-up')
  })
})

describe('showingLabel', () => {
  it('only appears when rows are hidden', () => {
    expect(showingLabel(8, 23)).toBe('Showing 8 of 23')
    expect(showingLabel(200, 1200)).toBe('Showing 200 of 1,200')
    expect(showingLabel(8, 8)).toBe('')
    expect(showingLabel(0, 0)).toBe('')
  })
})

describe('parseDueFilter', () => {
  it('reads overdue, today and next7', () => {
    expect(parseDueFilter('overdue')).toBe('overdue')
    expect(parseDueFilter('today')).toBe('today')
    expect(parseDueFilter('next7')).toBe('next7')
    expect(parseDueFilter('x')).toBeNull()
    expect(parseDueFilter(null)).toBeNull()
  })
})

describe('todayWindow', () => {
  it('is the business day: Kolkata', () => {
    const w = todayWindow(NOW, 'Asia/Kolkata')
    expect(w.gte.toISOString()).toBe('2026-11-07T18:30:00.000Z')
    expect(w.lt.toISOString()).toBe('2026-11-08T18:30:00.000Z')
  })
  it('one second before and after local midnight fall on different days', () => {
    const before = todayWindow(new Date('2026-11-07T18:29:59.999Z'), 'Asia/Kolkata')
    const after = todayWindow(new Date('2026-11-07T18:30:00.000Z'), 'Asia/Kolkata')
    expect(before.lt.getTime()).toBe(after.gte.getTime())
  })
  it('is 25 hours long on the day New York ends daylight saving (1 Nov 2026)', () => {
    const w = todayWindow(new Date('2026-11-01T12:00:00.000Z'), 'America/New_York')
    expect(w.gte.toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(w.lt.toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })
})

describe('parseCallsParams', () => {
  it('maps status=missed and day=today', () => {
    expect(parseCallsParams('missed', 'today')).toEqual({ filter: 'missed', today: true })
    expect(parseCallsParams('missed', null)).toEqual({ filter: 'missed', today: false })
  })
  it('ignores anything else', () => {
    expect(parseCallsParams('weird', 'today')).toEqual({ filter: 'all', today: true })
    expect(parseCallsParams(null, 'yesterday')).toEqual({ filter: 'all', today: false })
  })
})
