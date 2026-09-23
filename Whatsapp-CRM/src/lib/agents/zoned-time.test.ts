import { describe, it, expect } from 'vitest'
import { zonedInstant, localDate, localWeekday, offsetAt } from './zoned-time'

/**
 * "Tomorrow at nine" is a wall clock, and a wall clock is not a moment
 * until you know whose wall it is on. Getting this wrong rings somebody
 * before dawn.
 */

const IST = 'Asia/Kolkata'
const NY = 'America/New_York'

describe('zonedInstant', () => {
  it('reads a time in the business\'s zone, not the server\'s', () => {
    // 09:00 in Kolkata is 03:30 UTC. A server in any other zone that
    // took this literally would ring at the wrong hour — and India's
    // half-hour offset is the case a naive implementation gets wrong
    // even when it remembers to convert at all.
    const at = zonedInstant(IST, '2026-09-24', '09:00')!
    expect(at.toISOString()).toBe('2026-09-24T03:30:00.000Z')
  })

  it('handles the same wall clock in a different zone', () => {
    // 09:00 New York in September is EDT, UTC-4.
    const at = zonedInstant(NY, '2026-09-24', '09:00')!
    expect(at.toISOString()).toBe('2026-09-24T13:00:00.000Z')
  })

  it('survives the day the clocks go back', () => {
    // 1 November 2026, New York falls back. Whatever it returns must be
    // a real instant that reads as 09:00 there.
    const at = zonedInstant(NY, '2026-11-01', '09:00')!
    const shown = new Intl.DateTimeFormat('en-GB', {
      timeZone: NY,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at)
    expect(shown).toBe('09:00')
  })

  describe('times that do not exist', () => {
    it('refuses the hour a spring-forward skips', () => {
      // 8 March 2026: New York goes from 01:59 straight to 03:00, so
      // 02:30 never happens. Agreeing to it would mean saying 2:30 and
      // ringing at 3:30 — worse than admitting it was not understood.
      expect(zonedInstant(NY, '2026-03-08', '02:30')).toBeNull()
    })

    it('still accepts the hours either side of it', () => {
      expect(zonedInstant(NY, '2026-03-08', '01:30')).not.toBeNull()
      expect(zonedInstant(NY, '2026-03-08', '03:30')).not.toBeNull()
    })
  })

  describe('input it must not accept', () => {
    it('refuses a date that is not a date', () => {
      // Date.UTC quietly normalises 31 February into 3 March. Reading
      // the result back is what catches a day nobody meant.
      expect(zonedInstant(IST, '2026-02-31', '09:00')).toBeNull()
      expect(zonedInstant(IST, '2026-13-01', '09:00')).toBeNull()
      expect(zonedInstant(IST, '2026-09-00', '09:00')).toBeNull()
    })

    it('refuses a malformed shape', () => {
      expect(zonedInstant(IST, '24-09-2026', '09:00')).toBeNull()
      expect(zonedInstant(IST, 'tomorrow', '09:00')).toBeNull()
      expect(zonedInstant(IST, '2026-09-24', '9am')).toBeNull()
      expect(zonedInstant(IST, '2026-09-24', '')).toBeNull()
    })

    it('refuses an impossible clock time', () => {
      expect(zonedInstant(IST, '2026-09-24', '25:00')).toBeNull()
      expect(zonedInstant(IST, '2026-09-24', '09:60')).toBeNull()
    })

    it('refuses a zone that does not exist, rather than guessing UTC', () => {
      // Falling back to UTC would be five and a half hours out for this
      // business, in the direction that rings people before dawn.
      expect(zonedInstant('Mars/Olympus', '2026-09-24', '09:00')).toBeNull()
    })

    it('tolerates surrounding space', () => {
      expect(zonedInstant(IST, ' 2026-09-24 ', ' 09:00 ')).not.toBeNull()
    })
  })
})

describe('localDate', () => {
  it('gives the date where the business is, not where the server is', () => {
    // 22:00 UTC is already the next day in Kolkata. A server asking
    // "what is today" for a business five and a half hours ahead gets
    // yesterday, and "tomorrow" then resolves to today.
    const lateUtc = new Date('2026-09-23T22:00:00Z')
    expect(localDate(IST, lateUtc)).toBe('2026-09-24')
    expect(localDate(NY, lateUtc)).toBe('2026-09-23')
  })

  it('has no answer for a zone it does not know', () => {
    expect(localDate('Nowhere/Nothing')).toBeNull()
    expect(localWeekday('Nowhere/Nothing')).toBeNull()
  })

  it('names the weekday in that zone', () => {
    expect(localWeekday(IST, new Date('2026-09-23T22:00:00Z'))).toBe('Thursday')
    expect(localWeekday(NY, new Date('2026-09-23T22:00:00Z'))).toBe('Wednesday')
  })
})

describe('offsetAt', () => {
  it('knows about half-hour zones', () => {
    expect(offsetAt(IST, new Date('2026-09-24T00:00:00Z'))).toBe(5.5 * 60 * 60_000)
  })

  it('knows the offset changes during the year', () => {
    const summer = offsetAt(NY, new Date('2026-07-01T12:00:00Z'))
    const winter = offsetAt(NY, new Date('2026-01-01T12:00:00Z'))
    expect(summer).not.toBe(winter)
  })
})
