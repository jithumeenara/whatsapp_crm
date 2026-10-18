import { describe, expect, it } from 'vitest'
import { buildPatch, describeChange, phoneKey, pickRows, samePhone } from './contact-rows'

const fields = [
  { field_key: 'phone', label: 'WhatsApp No.', field_type: 'phone' },
  { field_key: 'status', label: 'Status', field_type: 'select' },
  { field_key: 'confirmed_on', label: 'Confirmed on', field_type: 'date' },
  { field_key: 'confirmed_at', label: 'Confirmed at', field_type: 'datetime' },
  { field_key: 'paid', label: 'Paid', field_type: 'boolean' },
  { field_key: 'seats', label: 'Seats', field_type: 'number' },
  { field_key: 'pin', label: 'PIN', field_type: 'password' },
  { field_key: 'photo', label: 'Photo', field_type: 'image' },
]

describe('finding the customer’s row by number', () => {
  it('treats +91, a leading 0, spaces and dashes as the same number', () => {
    expect(samePhone('+91 94950 43668', '9495043668')).toBe(true)
    expect(samePhone('09495043668', '+919495043668')).toBe(true)
    expect(samePhone('94950-43668', '919495043668')).toBe(true)
  })

  it('never matches a different number that shares the last eight digits', () => {
    expect(samePhone('+91 8495043668', '+91 9495043668')).toBe(false)
  })

  it('matches nothing on a number shorter than ten digits', () => {
    expect(phoneKey('43668')).toBeNull()
    expect(samePhone('5043668', '5043668')).toBe(false)
    expect(phoneKey(null)).toBeNull()
  })
})

describe('which rows change', () => {
  const newestFirst = ['r3', 'r2', 'r1']
  it('latest, oldest or all (at most 20)', () => {
    expect(pickRows(newestFirst, 'latest')).toEqual(['r3'])
    expect(pickRows(newestFirst, 'oldest')).toEqual(['r1'])
    expect(pickRows(newestFirst, 'all')).toEqual(['r3', 'r2', 'r1'])
    expect(pickRows(Array.from({ length: 30 }, (_, i) => i), 'all')).toHaveLength(20)
    expect(pickRows([], 'latest')).toEqual([])
  })
})

describe('what is written', () => {
  const now = new Date('2026-10-18T20:00:00Z') // 01:30 on the 19th in Kolkata

  it('writes only the chosen columns, with dates in the business zone', () => {
    const r = buildPatch(fields, [
      { field_key: 'status', mode: 'value', value: 'Confirmed' },
      { field_key: 'confirmed_on', mode: 'today' },
      { field_key: 'confirmed_at', mode: 'now' },
      { field_key: 'paid', mode: 'yes' },
      { field_key: 'seats', mode: 'value', value: '2' },
    ], now, 'Asia/Kolkata')
    expect(r).toEqual({
      patch: { status: 'Confirmed', confirmed_on: '2026-10-19', confirmed_at: '2026-10-19T01:30', paid: true, seats: 2 },
    })
  })

  it('refuses a column the table does not have, and secrets or files', () => {
    expect(buildPatch(fields, [{ field_key: 'nope', mode: 'value', value: 'x' }], now, 'UTC')).toHaveProperty('error')
    expect(buildPatch(fields, [{ field_key: 'pin', mode: 'value', value: '1234' }], now, 'UTC')).toHaveProperty('error')
    expect(buildPatch(fields, [{ field_key: 'photo', mode: 'clear' }], now, 'UTC')).toHaveProperty('error')
    expect(buildPatch(fields, [], now, 'UTC')).toHaveProperty('error')
  })

  it('says plainly what changed', () => {
    expect(describeChange({ status: 'Pending' }, { status: 'Confirmed', paid: true }, fields)).toBe('Status: Pending → Confirmed, Paid: (empty) → true')
  })
})
