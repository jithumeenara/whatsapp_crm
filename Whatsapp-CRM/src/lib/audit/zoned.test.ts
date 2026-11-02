import { describe, expect, it } from 'vitest'
import { dayEndIso, dayKey, dayStartIso } from './zoned'

/** A day picked in the audit filter means that day in the business's zone. */
describe('business-zone days', () => {
  it('starts a Kolkata day at midnight +05:30', () => {
    expect(dayStartIso('2026-11-02', 'Asia/Kolkata')).toBe('2026-11-02T00:00:00+05:30')
    expect(new Date(dayStartIso('2026-11-02', 'Asia/Kolkata')!).toISOString()).toBe('2026-11-01T18:30:00.000Z')
  })
  it('ends the day at the next midnight, across a month end', () => {
    expect(dayEndIso('2026-10-31', 'Asia/Kolkata')).toBe('2026-11-01T00:00:00+05:30')
  })
  it('handles a zone behind UTC and a DST change', () => {
    expect(dayStartIso('2026-03-08', 'America/New_York')).toBe('2026-03-08T00:00:00-05:00')
    expect(dayStartIso('2026-03-09', 'America/New_York')).toBe('2026-03-09T00:00:00-04:00')
  })
  it('refuses a date that does not exist', () => {
    expect(dayStartIso('2026-02-30', 'Asia/Kolkata')).toBeNull()
    expect(dayStartIso('2 Nov', 'Asia/Kolkata')).toBeNull()
  })
  it('names the business day of an instant, not the server day', () => {
    expect(dayKey(new Date('2026-11-01T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-02')
  })
})
