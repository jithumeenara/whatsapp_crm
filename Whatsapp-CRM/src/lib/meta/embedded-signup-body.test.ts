import { describe, expect, it } from 'vitest'
import { parseSignupBody } from './embedded-signup-body'

// The ids the signup popup posts come from the browser: digits only, and a
// WhatsApp Business app number (coexistence) needs no phone number id.

describe('parseSignupBody', () => {
  it('accepts a normal signup', () => {
    expect(parseSignupBody({ code: 'abc', wabaId: '1234567', phoneNumberId: '7654321' }))
      .toEqual({ code: 'abc', wabaId: '1234567', phoneNumberId: '7654321', coexistence: false })
  })

  it('accepts coexistence with the WABA only', () => {
    expect(parseSignupBody({ code: 'abc', wabaId: '1234567', coexistence: true }))
      .toEqual({ code: 'abc', wabaId: '1234567', coexistence: true })
  })

  it('refuses ids that are not Meta digits, and missing parts', () => {
    expect(parseSignupBody({ code: 'abc', wabaId: '12/../x', phoneNumberId: '7654321' })).toHaveProperty('error')
    expect(parseSignupBody({ code: 'abc', wabaId: '1234567' })).toHaveProperty('error')
    expect(parseSignupBody({ code: '', wabaId: '1234567', phoneNumberId: '7654321' })).toHaveProperty('error')
    expect(parseSignupBody({ code: 'x'.repeat(3000), wabaId: '1234567', phoneNumberId: '7654321' })).toHaveProperty('error')
    expect(parseSignupBody(null)).toHaveProperty('error')
  })
})
