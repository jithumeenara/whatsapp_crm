import { describe, it, expect, beforeAll } from 'vitest'
import { parseFormConfig, formState, formFieldOrder } from './public-form'
import {
  checkRenderTicket,
  issueRenderTicket,
  signPersonalLink,
  verifyPersonalLink,
  validateFormValues,
  newFormToken,
  FORM_TOKEN,
} from './public-form-server'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= 'test-secret-for-forms'
})

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const C1 = '33333333-3333-4333-8333-333333333333'

describe('form settings', () => {
  it('reads only what is valid', () => {
    const c = parseFormConfig(
      {
        enabled: 1,
        title: '  Register  ',
        field_keys: ['name', 'gone', 'name', 5],
        max_responses: -3,
        closes_at: 'not a date',
        consent_text: 'x'.repeat(900),
      },
      ['name', 'phone'],
    )
    expect(c.enabled).toBe(false)
    expect(c.title).toBe('Register')
    expect(c.field_keys).toEqual(['name'])
    expect(c.max_responses).toBeNull()
    expect(c.closes_at).toBeNull()
    expect(c.consent_text).toHaveLength(500)
  })

  it('knows when it is closed', () => {
    const open = parseFormConfig({ enabled: true })
    expect(formState(open, 0)).toEqual({ open: true })
    expect(formState(parseFormConfig({ enabled: false }), 0)).toEqual({ open: false, reason: 'off' })
    expect(formState(parseFormConfig({ enabled: true, max_responses: 2 }), 2)).toEqual({ open: false, reason: 'full' })
    const past = parseFormConfig({ enabled: true, closes_at: '2020-01-01T00:00:00Z' })
    expect(formState(past, 0)).toEqual({ open: false, reason: 'closed' })
  })

  it('shows only fields a web form can hold, in the chosen order', () => {
    const fields = [
      { field_key: 'a', field_type: 'text' },
      { field_key: 'f', field_type: 'file' },
      { field_key: 'b', field_type: 'select' },
    ]
    expect(formFieldOrder(fields, { field_keys: [] }).map((f) => f.field_key)).toEqual(['a', 'b'])
    expect(formFieldOrder(fields, { field_keys: ['b', 'f', 'a'] }).map((f) => f.field_key)).toEqual(['b', 'a'])
  })
})

describe('form links', () => {
  it('makes long random tokens', () => {
    const t = newFormToken()
    expect(FORM_TOKEN.test(t)).toBe(true)
    expect(t).not.toBe(newFormToken())
  })

  it('personal links work for their own table only and cannot be edited', () => {
    const link = signPersonalLink(T1, C1)
    expect(verifyPersonalLink(T1, link)).toBe(C1)
    expect(verifyPersonalLink(T2, link)).toBeNull()
    expect(verifyPersonalLink(T1, link.replace(C1, T2))).toBeNull()
    expect(verifyPersonalLink(T1, C1)).toBeNull()
    expect(verifyPersonalLink(T1, null)).toBeNull()
  })

  it('refuses a submission made too fast, too late, or without a real ticket', () => {
    const now = Date.now()
    const ticket = issueRenderTicket('tok', now)
    expect(checkRenderTicket('tok', ticket, now + 500)).toBe('too_fast')
    expect(checkRenderTicket('tok', ticket, now + 10_000)).toBe('ok')
    expect(checkRenderTicket('tok', ticket, now + 13 * 60 * 60_000)).toBe('expired')
    expect(checkRenderTicket('other', ticket, now + 10_000)).toBe('invalid')
    expect(checkRenderTicket('tok', `${now - 60_000}.forged`, now)).toBe('invalid')
    expect(checkRenderTicket('tok', undefined, now)).toBe('invalid')
  })
})

describe('validateFormValues', () => {
  const fields = [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'about', label: 'About', type: 'textarea', required: false },
    { key: 'course', label: 'Course', type: 'radio', required: true, options: ['PSC', 'SSC'] },
    { key: 'at', label: 'Time', type: 'time', required: false },
    { key: 'agree', label: 'Agree', type: 'boolean', required: true },
    { key: 'phone', label: 'Phone', type: 'phone', required: false },
  ]

  it('accepts a good answer, in the table’s own spelling', () => {
    const r = validateFormValues(fields, { name: ' Anu ', course: 'psc', at: '09:30', agree: true, phone: '+91 98765 43210' })
    expect(r).toEqual({
      ok: true,
      values: { name: 'Anu', course: 'PSC', at: '09:30', agree: true, phone: '+91 98765 43210' },
    })
  })

  it('says what is wrong', () => {
    const r = validateFormValues(fields, { course: 'IAS', at: '25:00', agree: false, extra: 'x', about: { a: 1 } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.problems.join(' ')).toMatch(/Name.*required/)
    expect(r.problems.join(' ')).toMatch(/Course/)
    expect(r.problems.join(' ')).toMatch(/Time/)
    expect(r.problems.join(' ')).toMatch(/tick "Agree"/)
    expect(r.problems.join(' ')).toMatch(/does not have/)
    expect(r.problems.join(' ')).toMatch(/About.*could not be read/)
  })

  it('ignores section headings and applies the table’s own limits', () => {
    const withLimits = [
      { key: 'part', label: 'About you', type: 'section_header', required: false },
      { key: 'name', label: 'Name', type: 'text', required: true, minLength: 3, maxLength: 10 },
      { key: 'age', label: 'Age', type: 'number', required: false, min: 18, max: 60 },
    ]
    expect(validateFormValues(withLimits, { name: 'Anu Mathew', age: '30' })).toEqual({
      ok: true,
      values: { name: 'Anu Mathew', age: 30 },
    })
    const bad = validateFormValues(withLimits, { name: 'An', age: '12' })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.problems.join(' ')).toMatch(/at least 3 characters/)
    expect(bad.problems.join(' ')).toMatch(/at least 18/)
    // A heading takes no answer.
    expect(validateFormValues(withLimits, { part: 'x', name: 'Anu' }).ok).toBe(false)
  })

  it('refuses nothing-at-all', () => {
    expect(validateFormValues(fields, null).ok).toBe(false)
    expect(validateFormValues(fields, ['x']).ok).toBe(false)
  })
})
