import { describe, expect, it } from 'vitest'
import { dayKeyInZone, formatInZone } from './business-time'

describe('business times in the business zone', () => {
  // 20:00 UTC on 15 Nov is 01:30 on 16 Nov in Kolkata.
  const lateUtc = '2026-11-15T20:00:00.000Z'

  it('the day is the business day, not the UTC day', () => {
    expect(dayKeyInZone(lateUtc, 'Asia/Kolkata')).toBe('2026-11-16')
    expect(dayKeyInZone(lateUtc, 'UTC')).toBe('2026-11-15')
  })

  it('the time is shown in the zone', () => {
    expect(formatInZone(lateUtc, 'Asia/Kolkata', { hour: 'numeric', minute: '2-digit', hour12: false })).toBe('01:30')
  })

  it('an unknown or empty zone falls back to Asia/Kolkata', () => {
    expect(dayKeyInZone(lateUtc, 'Mars/Base')).toBe('2026-11-16')
    expect(dayKeyInZone(lateUtc, '')).toBe('2026-11-16')
  })

  it('a missing or broken date gives an empty string, not "Invalid Date"', () => {
    expect(formatInZone(null, 'UTC')).toBe('')
    expect(formatInZone('not a date', 'UTC')).toBe('')
    expect(dayKeyInZone('not a date', 'UTC')).toBe('')
  })
})
