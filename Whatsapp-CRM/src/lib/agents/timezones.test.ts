import { describe, expect, it } from 'vitest'
import {
  allTimezones,
  displayZoneId,
  searchTimezones,
  offsetLabel,
  currentTimeIn,
  describeZone,
  isKnownTimezone,
} from './timezones'

const NOON_UTC = new Date('2026-09-21T12:00:00Z')

describe('the list itself', () => {
  it('is the whole world, not a list somebody typed', () => {
    // A hand-written list goes stale silently: zones are added, renamed
    // and merged, and somebody in a newly-split zone would simply never
    // find their own city. Four hundred-odd is what the runtime knows.
    const zones = allTimezones()
    expect(zones.length).toBeGreaterThan(300)
    expect(zones).toContain('America/New_York')
    expect(zones).toContain('Pacific/Auckland')
  })

  it('does not assume the runtime uses the names people use', () => {
    // The finding that made the rename map necessary: this runtime
    // lists Asia/Calcutta and has never heard of Asia/Kolkata. Asserted
    // loosely — a future ICU that switches to the modern name must not
    // fail this file — but asserted, because the day it changes is the
    // day the map can start shrinking.
    const zones = allTimezones()
    const india = zones.filter((z) => /calcutta|kolkata/i.test(z))
    expect(india).toHaveLength(1)
  })

  it('is sorted, so the unsearched list is not arbitrary', () => {
    const zones = allTimezones()
    expect([...zones].sort()).toEqual(zones)
  })
})

describe('searching', () => {
  it('finds a city somebody would actually type', () => {
    expect(searchTimezones('new york')).toContain('America/New_York')
  })

  it('finds a city under the name it uses today, not the one ICU filed it under', () => {
    // The bug this caught: an Indian user searching their own city got
    // an empty list, because this runtime only knows "Calcutta".
    const results = searchTimezones('kolkata')
    expect(results).toHaveLength(1)
    expect(displayZoneId(results[0])).toBe('Asia/Kolkata')

    const kyiv = searchTimezones('kyiv')
    expect(kyiv.length).toBeGreaterThan(0)
    expect(displayZoneId(kyiv[0])).toBe('Europe/Kyiv')
  })

  it('still finds it under the old name, because some people will type that', () => {
    expect(searchTimezones('calcutta').length).toBeGreaterThan(0)
  })

  it('handles the underscore nobody types', () => {
    // The IANA name is "New_York". Requiring the underscore would make
    // the search look broken to every person who has ever used it.
    expect(searchTimezones('new york')).toContain('America/New_York')
  })

  it('ignores case', () => {
    expect(searchTimezones('KOLKATA').length).toBeGreaterThan(0)
  })

  it('puts city matches before region matches', () => {
    // Somebody typing "york" means New York. Burying it under every
    // zone whose region happens to contain the letters would read as a
    // broken search.
    const results = searchTimezones('york')
    expect(results[0]).toBe('America/New_York')
  })

  it('finds a zone named after its country', () => {
    // IANA names a few zones after countries rather than cities, and
    // somebody searching for theirs should not come up empty.
    expect(searchTimezones('singapore')).toContain('Asia/Singapore')
  })

  it('returns nothing rather than something wrong', () => {
    expect(searchTimezones('zzzznowhere')).toEqual([])
  })

  it('caps a broad search so the list stays a list', () => {
    expect(searchTimezones('a', 20).length).toBeLessThanOrEqual(20)
  })
})

describe('saying an offset out loud', () => {
  it('gives India its half hour', () => {
    // The offset people actually check, and the one a picker that only
    // showed names would let them get wrong by thirty minutes.
    expect(offsetLabel('Asia/Kolkata', NOON_UTC)).toBe('UTC+5:30')
  })

  it('works under either spelling, because either one may have been stored', () => {
    // This is what makes the rename map safe: the display changes, the
    // arithmetic does not care.
    expect(offsetLabel('Asia/Calcutta', NOON_UTC)).toBe(offsetLabel('Asia/Kolkata', NOON_UTC))
    expect(currentTimeIn('Asia/Calcutta', NOON_UTC)).toBe(currentTimeIn('Asia/Kolkata', NOON_UTC))
  })

  it('writes UTC rather than GMT', () => {
    expect(offsetLabel('Europe/London', NOON_UTC)).toMatch(/^UTC/)
    expect(offsetLabel('UTC', NOON_UTC)).toBe('UTC+0:00')
  })

  it('follows daylight saving instead of assuming a fixed offset', () => {
    // The reason an offset is never stored: London is +1 in summer and
    // +0 in winter, and a saved "+01:00" would be wrong for half the
    // year with nothing on screen to say so.
    const summer = offsetLabel('Europe/London', new Date('2026-07-01T12:00:00Z'))
    const winter = offsetLabel('Europe/London', new Date('2026-01-01T12:00:00Z'))
    expect(summer).not.toBe(winter)
  })

  it('says nothing rather than guessing for a zone it does not know', () => {
    expect(offsetLabel('Mars/Olympus', NOON_UTC)).toBe('')
  })
})

describe('the clock beside each zone', () => {
  it('shows the real local time', () => {
    // Noon UTC is half past five in the evening in Kolkata.
    expect(currentTimeIn('Asia/Kolkata', NOON_UTC)).toBe('5:30 PM')
  })

  it('is empty for a zone it cannot resolve', () => {
    expect(currentTimeIn('Mars/Olympus', NOON_UTC)).toBe('')
  })
})

describe('reading a zone name', () => {
  it('splits the city from the region', () => {
    expect(describeZone('Asia/Kolkata')).toEqual({ city: 'Kolkata', region: 'Asia' })
  })

  it('shows a renamed city under its current name', () => {
    // Calcutta has not been called that since 2001. Offering it as a
    // choice is a small humiliation and an easy one to avoid.
    expect(describeZone('Asia/Calcutta').city).toBe('Kolkata')
    expect(describeZone('Europe/Kiev').city).toBe('Kyiv')
  })

  it('leaves a zone nobody renamed alone', () => {
    expect(displayZoneId('Europe/London')).toBe('Europe/London')
  })

  it('unpicks the underscores nobody wants to read', () => {
    expect(describeZone('America/New_York').city).toBe('New York')
  })

  it('handles the three-part names', () => {
    expect(describeZone('America/Argentina/Buenos_Aires')).toEqual({
      city: 'Buenos Aires',
      region: 'America / Argentina',
    })
  })

  it('copes with a name that has no region at all', () => {
    expect(describeZone('UTC')).toEqual({ city: 'UTC', region: '' })
  })
})

describe('checking a zone before storing it', () => {
  it('accepts a real one', () => {
    expect(isKnownTimezone('Asia/Kolkata')).toBe(true)
  })

  it('refuses one this server cannot resolve', () => {
    // Stored unchecked, a typo would silently fall back to the server's
    // own clock — the exact failure the column exists to end.
    expect(isKnownTimezone('Mars/Olympus')).toBe(false)
    expect(isKnownTimezone('')).toBe(false)
    expect(isKnownTimezone('UTC+5:30')).toBe(false)
  })
})
