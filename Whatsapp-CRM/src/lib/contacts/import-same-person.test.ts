import { describe, expect, it } from 'vitest'
import { samePerson } from './csv-import'

// Review findings: a Telegram id or another country's number must never
// be taken for the file's number.
describe('is this the same person', () => {
  it('with or without the country code or a trunk 0', () => {
    expect(samePerson('+91 98765 43210', '9876543210')).toBe(true)
    expect(samePerson('09876543210', '919876543210')).toBe(true)
  })

  it('two numbers that both carry a country code must match in full', () => {
    expect(samePerson('+1 917 555 0100', '+91 917 555 0100')).toBe(false)
  })

  it('short or empty numbers never match', () => {
    expect(samePerson('12345', '12345')).toBe(false)
    expect(samePerson('', '9876543210')).toBe(false)
  })
})
