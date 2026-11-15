import { describe, expect, it } from 'vitest'
import { placeOf, weekdayRows } from './ad-extras'

describe('placeOf', () => {
  it('a WhatsApp ad click without a click id came from a WhatsApp Status ad', () => {
    expect(placeOf({ channel: 'whatsapp', platform: null, click_id: null })).toBe('WhatsApp Status')
  })
  it('Facebook or Instagram only when Meta said so; otherwise not known', () => {
    expect(placeOf({ channel: 'whatsapp', platform: 'instagram', click_id: 'c1' })).toBe('Instagram')
    expect(placeOf({ channel: 'lead_form', platform: 'facebook', click_id: null })).toBe('Facebook')
    expect(placeOf({ channel: 'whatsapp', platform: null, click_id: 'c1' })).toBe('Not known')
    expect(placeOf({ channel: 'messenger', platform: 'weird', click_id: null })).toBe('Not known')
  })
})

describe('weekdayRows', () => {
  it('Monday first, every day present, won % only with enough leads', () => {
    const rows = weekdayRows(
      [{ dow: 1, n: 30 }, { dow: 0, n: 4 }],
      [{ dow: 1, leads: 12, won: 3 }, { dow: 0, leads: 2, won: 1 }],
    )
    expect(rows.map((r) => r.day)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    expect(rows[0]).toMatchObject({ arrivals: 30, leads: 12, won: 3, wonPct: 25 })
    expect(rows[6]).toMatchObject({ arrivals: 4, leads: 2, wonPct: null })
    expect(rows[1]).toMatchObject({ arrivals: 0, leads: 0, won: 0, wonPct: null })
  })
})
