import { describe, it, expect } from 'vitest'
import { normalizeEnteredPhone, parseFollowUpInput } from './new-follow-up'

const NOW = new Date('2026-09-23T06:00:00Z')
const soon = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString()
const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'

describe('normalizeEnteredPhone', () => {
  it('adds India\'s code to a bare mobile number', () => {
    expect(normalizeEnteredPhone('9847012345')).toBe('919847012345')
    expect(normalizeEnteredPhone('098470 12345')).toBe('919847012345')
    expect(normalizeEnteredPhone('98470-12345')).toBe('919847012345')
  })
  it('keeps a number that already has its country code', () => {
    expect(normalizeEnteredPhone('+91 98470 12345')).toBe('919847012345')
    expect(normalizeEnteredPhone('971501234567')).toBe('971501234567')
  })
  it('refuses what is not a number', () => {
    for (const bad of ['', 'abc', '12', '0000000000', '1234567890123456789']) {
      expect(normalizeEnteredPhone(bad), bad).toBeNull()
    }
  })
})

describe('parseFollowUpInput', () => {
  const base = { contact_id: ID, due_at: soon, description: 'Wants next batch dates' }

  it('accepts a picked contact', () => {
    const r = parseFollowUpInput(base, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.contactId).toBe(ID); expect(r.phone).toBeNull() }
  })

  it('accepts a new number instead', () => {
    const r = parseFollowUpInput({ ...base, contact_id: undefined, phone: '9847012345', name: ' Anu ' }, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.phone).toBe('919847012345'); expect(r.name).toBe('Anu') }
  })

  it('refuses a contact id that is not an id', () => {
    expect(parseFollowUpInput({ ...base, contact_id: "1' OR 1=1" }, NOW).ok).toBe(false)
  })

  it('needs someone to call', () => {
    expect(parseFollowUpInput({ ...base, contact_id: undefined }, NOW).ok).toBe(false)
    expect(parseFollowUpInput({ ...base, contact_id: undefined, phone: 'call later' }, NOW).ok).toBe(false)
  })

  it('refuses a time already gone, but not a slow form', () => {
    const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    const minuteAgo = new Date(NOW.getTime() - 60 * 1000).toISOString()
    expect(parseFollowUpInput({ ...base, due_at: hourAgo }, NOW).ok).toBe(false)
    expect(parseFollowUpInput({ ...base, due_at: minuteAgo }, NOW).ok).toBe(true)
  })

  it('refuses more than a year out and a date that is not one', () => {
    expect(parseFollowUpInput({ ...base, due_at: '2028-01-01T00:00:00Z' }, NOW).ok).toBe(false)
    expect(parseFollowUpInput({ ...base, due_at: 'tomorrow' }, NOW).ok).toBe(false)
  })

  it('needs a description, and not an essay', () => {
    expect(parseFollowUpInput({ ...base, description: '   ' }, NOW).ok).toBe(false)
    expect(parseFollowUpInput({ ...base, description: 'x'.repeat(2001) }, NOW).ok).toBe(false)
  })

  it('refuses a body that is not an object', () => {
    expect(parseFollowUpInput(null, NOW).ok).toBe(false)
    expect(parseFollowUpInput('hi', NOW).ok).toBe(false)
  })
})
