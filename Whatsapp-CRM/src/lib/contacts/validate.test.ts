import { describe, expect, it } from 'vitest'
import { checkEmail, checkPhone, isEmailPlaceholderPhone, isPlaceholderPhone } from './validate'

describe('checkPhone', () => {
  it('accepts numbers as people type them and keeps the +', () => {
    expect(checkPhone('+91 98765 43210')).toEqual({ ok: true, value: '+919876543210' })
    expect(checkPhone('919876543210')).toEqual({ ok: true, value: '919876543210' })
    expect(checkPhone('(0484) 123-4567')).toEqual({ ok: true, value: '04841234567' })
  })

  it('refuses what is not a number', () => {
    expect(checkPhone('email:someone@example.com').ok).toBe(false)
    expect(checkPhone('abc').ok).toBe(false)
    expect(checkPhone('12345').ok).toBe(false)
    expect(checkPhone('+0919876543210').ok).toBe(false)
    expect(checkPhone('1234567890123456').ok).toBe(false)
    expect(checkPhone('   ').ok).toBe(false)
  })
})

describe('checkEmail', () => {
  it('accepts an address, trimmed and lowercased', () => {
    expect(checkEmail('  Training@ACSTIkerala.com ')).toEqual({ ok: true, value: 'training@acstikerala.com' })
  })

  it('refuses what is not an address', () => {
    for (const bad of ['name', 'name@', '@example.com', 'name@example', 'a b@example.com', 'name@example..com', 'name@example.c']) {
      expect(checkEmail(bad).ok).toBe(false)
    }
  })
})

describe('isEmailPlaceholderPhone', () => {
  it('knows an email-only contact\'s placeholder from a number', () => {
    expect(isEmailPlaceholderPhone('email:someone@example.com')).toBe(true)
    expect(isEmailPlaceholderPhone('+919876543210')).toBe(false)
    expect(isEmailPlaceholderPhone(null)).toBe(false)
  })
})

describe('Telegram placeholder', () => {
  it('tg:<id> is not a phone number', () => {
    expect(isPlaceholderPhone('tg:7012345678')).toBe(true)
    expect(isPlaceholderPhone('+917012345678')).toBe(false)
  })
})
