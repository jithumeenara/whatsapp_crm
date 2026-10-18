import { describe, expect, it } from 'vitest'
import { equalsAsPhone } from './contact-rows'

describe('"is" with a phone number', () => {
  it('compares a plain number by its last 10 digits', () => {
    expect(equalsAsPhone('+91 99478 40578')).toBe('9947840578')
    expect(equalsAsPhone('9947840578')).toBe('9947840578')
  })
  it('stays exact text for anything that is not plainly a number', () => {
    expect(equalsAsPhone('R-1045')).toBeNull()
    expect(equalsAsPhone('Kannur')).toBeNull()
    expect(equalsAsPhone('12345')).toBeNull()
  })
})
