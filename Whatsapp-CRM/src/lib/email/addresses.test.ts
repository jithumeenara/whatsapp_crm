import { describe, it, expect } from 'vitest'
import { parseAddresses } from './conversation-send'

describe('parseAddresses', () => {
  it('takes a comma, semicolon or space separated list, once each, lowercased', () => {
    expect(parseAddresses('A@x.com, b@y.in; a@x.com  c@z.org')).toEqual(['a@x.com', 'b@y.in', 'c@z.org'])
    expect(parseAddresses(['a@x.com'])).toEqual(['a@x.com'])
    expect(parseAddresses('')).toEqual([])
    expect(parseAddresses(undefined)).toEqual([])
  })

  it('refuses anything that could become a header or a display-name trick', () => {
    expect(() => parseAddresses('a@x.com\r\nBcc: evil@x.com')).toThrow()
    expect(() => parseAddresses('"Boss" <evil@x.com>')).toThrow()
    expect(() => parseAddresses('not-an-address')).toThrow()
  })

  it('caps how many', () => {
    const many = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(',')
    expect(() => parseAddresses(many)).toThrow(/At most/)
  })
})
