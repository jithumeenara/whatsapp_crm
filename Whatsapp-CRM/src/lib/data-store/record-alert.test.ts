import { describe, it, expect } from 'vitest'
import {
  parseAlertConfig,
  wantsSource,
  matchesCondition,
  isSensitiveField,
  summarizeRecord,
  maskValue,
} from './record-alert'

const UID = '0b6f5a4e-6d0c-4a8e-9a57-2a3f1c9e7b10'

describe('parseAlertConfig', () => {
  it('drops anything malformed rather than acting on it', () => {
    const c = parseAlertConfig({
      enabled: 'yes',
      sources: ['web_form', 'import', 'nonsense', 'web_form'],
      push_user_ids: [UID, 'not-a-uuid', UID],
      emails: ['Boss@Example.com', 'x@y', 'a@b.co\r\nBcc: evil@x.com', 'boss@example.com'],
      whatsapp_numbers: ['+91 98765 43210', '123', '919876543210'],
      whatsapp_template: 'New Record!',
      condition: { field_key: 'course', equals: '  PSC  ' },
    })
    expect(c.enabled).toBe(false)
    // An import is never alerted, whatever is stored.
    expect(c.sources).toEqual(['web_form'])
    expect(c.push_user_ids).toEqual([UID])
    expect(c.emails).toEqual(['boss@example.com'])
    expect(c.whatsapp_numbers).toEqual(['919876543210'])
    expect(c.whatsapp_template).toBeNull()
    expect(c.condition).toEqual({ field_key: 'course', equals: 'PSC' })
  })

  it('caps how many recipients there can be', () => {
    const emails = Array.from({ length: 9 }, (_, i) => `u${i}@x.com`)
    expect(parseAlertConfig({ emails }).emails).toHaveLength(5)
  })

  it('forgets a condition on a field the table no longer has', () => {
    expect(parseAlertConfig({ condition: { field_key: 'gone', equals: 'x' } }, ['name']).condition).toBeNull()
  })

  it('reads nothing from junk', () => {
    expect(parseAlertConfig(null).enabled).toBe(false)
    expect(parseAlertConfig([1, 2]).emails).toEqual([])
  })
})

describe('wantsSource', () => {
  const any = parseAlertConfig({ enabled: true })
  it('takes every person-driven source when none are picked', () => {
    expect(wantsSource(any, 'whatsapp_flow')).toBe(true)
    expect(wantsSource(any, 'web_form')).toBe(true)
  })
  it('never alerts bulk arrivals or unknown rows', () => {
    expect(wantsSource(any, 'import')).toBe(false)
    expect(wantsSource(any, 'integration')).toBe(false)
    expect(wantsSource(any, null)).toBe(false)
  })
  it('honours a pick', () => {
    const only = parseAlertConfig({ enabled: true, sources: ['web_form'] })
    expect(wantsSource(only, 'web_form')).toBe(true)
    expect(wantsSource(only, 'chatbot')).toBe(false)
  })
})

describe('matchesCondition', () => {
  it('compares ignoring case and spaces, and looks inside lists', () => {
    expect(matchesCondition({ field_key: 'c', equals: 'psc' }, { c: ' PSC ' })).toBe(true)
    expect(matchesCondition({ field_key: 'c', equals: 'psc' }, { c: ['SSC', 'Psc'] })).toBe(true)
    expect(matchesCondition({ field_key: 'c', equals: 'psc' }, { c: 'SSC' })).toBe(false)
    expect(matchesCondition({ field_key: 'c', equals: 'psc' }, {})).toBe(false)
    expect(matchesCondition(null, {})).toBe(true)
  })
})

describe('what an alert may say', () => {
  it('treats identity numbers and secrets as sensitive, whatever the column is called', () => {
    const f = (label: string, field_key = 'x', field_type = 'text') => ({ label, field_key, field_type })
    expect(isSensitiveField(f('Aadhaar Number'))).toBe(true)
    expect(isSensitiveField(f('x', 'aadhar_no'))).toBe(true)
    expect(isSensitiveField(f('PAN'))).toBe(true)
    expect(isSensitiveField(f('Bank Account No'))).toBe(true)
    expect(isSensitiveField(f('OTP'))).toBe(true)
    expect(isSensitiveField(f('Anything', 'x', 'password'))).toBe(true)
    expect(isSensitiveField(f('Name'))).toBe(false)
    expect(isSensitiveField(f('Pin code', 'pin_code'))).toBe(false)
    expect(isSensitiveField(f('Company'))).toBe(false)
  })

  it('masks to the last four', () => {
    expect(maskValue('1234 5678 9012')).toBe('••••9012')
    expect(maskValue('12')).toBe('••••')
  })

  it('sends the first few filled fields, masked and cut short', () => {
    const fields = [
      { field_key: 'h', label: 'Header', field_type: 'section_header' },
      { field_key: 'name', label: 'Name', field_type: 'text' },
      { field_key: 'empty', label: 'Empty', field_type: 'text' },
      { field_key: 'aadhaar', label: 'Aadhaar', field_type: 'text' },
      { field_key: 'photo', label: 'Photo', field_type: 'image' },
      { field_key: 'note', label: 'Note', field_type: 'textarea' },
    ]
    const lines = summarizeRecord(
      fields,
      { name: 'Anu\nMathew', aadhaar: '1234 5678 9012', photo: '/api/files/x', note: 'x'.repeat(100) },
      { max: 4, maxLength: 20 },
    )
    expect(lines).toEqual([
      { label: 'Name', value: 'Anu Mathew' },
      { label: 'Aadhaar', value: '••••9012' },
      { label: 'Photo', value: '(file attached)' },
      { label: 'Note', value: `${'x'.repeat(19)}…` },
    ])
  })
})
