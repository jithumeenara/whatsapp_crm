import { describe, expect, it } from 'vitest'
import { combinePhone, splitInternational } from './phone-entry'

describe('phone typed as country + number', () => {
  it('joins the country code and the number, dropping a leading 0', () => {
    expect(combinePhone('IN', '98470 12345')).toBe('+919847012345')
    expect(combinePhone('IN', '09847012345')).toBe('+919847012345')
    expect(combinePhone('AE', '50 123 4567')).toBe('+971501234567')
  })

  it('a whole international number typed in the box is kept as it is', () => {
    expect(combinePhone('IN', '+971 50 123 4567')).toBe('+971501234567')
    expect(combinePhone('IN', '0044 7700 900123')).toBe('+447700900123')
  })

  it('nothing typed is nothing — not a bare country code', () => {
    expect(combinePhone('IN', '')).toBe('')
    expect(combinePhone('IN', '  - ')).toBe('')
    expect(combinePhone('IN', '+')).toBe('')
  })

  it('splits a pasted international number into its country and number', () => {
    expect(splitInternational('+91 98470 12345')).toEqual({ iso: 'IN', local: '9847012345' })
    expect(splitInternational('9847012345')).toBeNull()
  })
})
