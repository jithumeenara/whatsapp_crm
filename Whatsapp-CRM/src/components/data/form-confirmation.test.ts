import { describe, expect, it } from 'vitest'
import { confirmationView, isMaskedAnswer, shown, submittedText } from './form-confirmation'
import { FORM_STRINGS } from './form-strings'
import { parseFormConfig, displayRef } from '@/lib/data-store/public-form'

const p = { t: FORM_STRINGS.en, lang: 'en', optionText: (k: string, v: string) => (k === 'month' && v === 'November' ? 'നവംബർ' : v) }
const f = (key: string, label: string, type = 'text', columnLabel?: string) => ({ key, label, type, required: false, columnLabel })

describe('answers shown back on the confirmation', () => {
  it('masks ID and bank account numbers, but not a bank’s name', () => {
    expect(shown(f('aadhaar', 'Aadhaar No'), '1234 5678 9012', p)).toBe('••••••••9012')
    expect(shown(f('acc', 'Bank Account No'), '123456789012', p)).toBe('••••••••9012')
    expect(shown(f('bank', 'Name of Bank / Society'), 'Sample Service Co-op Bank', p)).toBe('Sample Service Co-op Bank')
  })

  it('masks by the column key when the label is in another script (bug: a Malayalam label showed the Aadhaar number in full)', () => {
    expect(shown(f('aadhaar_no', 'ആധാർ നമ്പർ'), '1234 5678 9012', p)).toBe('••••••••9012')
    expect(shown(f('bank_account_no', 'അക്കൗണ്ട് നമ്പർ'), '123456789012', p)).toBe('••••••••9012')
  })

  it('masks by the column’s own name even under a friendlier heading', () => {
    expect(shown(f('id_no', 'Your 12-digit ID', 'text', 'Aadhaar number'), '1234 5678 9012', p)).toBe('••••••••9012')
  })

  it('writes dates out, shows options in the reader’s language, and a tick as yes', () => {
    expect(shown(f('from', 'From date', 'date'), '2026-09-29', p)).toBe('29 September 2026')
    expect(shown(f('month', 'Month', 'radio'), 'November', p)).toBe('നവംബർ')
    expect(shown(f('ok', 'Agree', 'boolean'), true, p)).toBe('Yes')
    expect(shown(f('ok', 'Agree', 'boolean'), false, p)).toBe('')
    expect(shown(f('x', 'X'), undefined, p)).toBe('')
  })
})

describe('what is not a secret stays readable', () => {
  it('a postal PIN code and an account holder’s name are shown in full', () => {
    expect(isMaskedAnswer(f('pin', 'PIN code'), '680001')).toBe(false)
    expect(isMaskedAnswer(f('holder', 'Account holder name'), 'Anu S')).toBe(false)
    expect(isMaskedAnswer(f('acc_no', 'Account number'), '123456789012')).toBe(true)
    expect(isMaskedAnswer(f('otp', 'OTP'), 'abc')).toBe(true)
  })

  it('a heading naming two things still masks the number (bug: "Name and Aadhaar number" showed it in full)', () => {
    expect(isMaskedAnswer(f('x', 'Name and Aadhaar number'), '1234 5678 9012')).toBe(true)
    expect(isMaskedAnswer(f('y', 'Bank name and account number'), 'SBI 123456789012')).toBe(true)
  })

  it('a choice or a word is never masked (bug: "Do you have a bank account? Yes" showed as •••)', () => {
    expect(shown(f('has_acc', 'Do you have a bank account?', 'radio'), 'Yes', p)).toBe('Yes')
    expect(shown(f('acc_type', 'Account type', 'select'), 'Savings', p)).toBe('Savings')
    expect(shown(f('acc_type', 'Account type'), 'Savings', p)).toBe('Savings')
  })
})

describe('what the confirmation shows', () => {
  const fields = [
    f('programme', 'Programme', 'select'),
    f('reason', 'Why not?', 'text'),
    f('heading', 'Section', 'section_header'),
    f('name', 'Name'),
    f('designation', 'Designation'),
    f('aadhaar', 'Aadhaar No'),
  ]
  const base = { t: FORM_STRINGS.en, lang: 'en', optionText: (_k: string, v: string) => v, fields, groupKeys: ['name', 'designation', 'aadhaar'], nameKey: 'name', groupLabel: 'Participant' }

  it('only answers that were sent: a question hidden by a rule is not in what was sent, so it never shows (bug)', () => {
    const v = confirmationView({ ...base, summaryKeys: [], personKeys: [], shared: { programme: 'Leadership' } })
    expect(v.summary.map((x) => x.f.key)).toEqual(['programme'])
    const chosen = confirmationView({ ...base, summaryKeys: ['programme', 'reason'], personKeys: [], shared: { programme: 'Leadership' } })
    expect(chosen.summary.map((x) => x.f.key)).toEqual(['programme'])
  })

  it('the summary never takes a per-person question; the people never take a shared one, nor the name twice', () => {
    const v = confirmationView({ ...base, summaryKeys: ['programme', 'designation'], personKeys: ['name', 'programme', 'designation'], shared: { programme: 'Leadership' } })
    expect(v.summary.map((x) => x.f.key)).toEqual(['programme'])
    expect(v.columns.map((c) => c.key)).toEqual(['designation'])
  })

  it('with nothing chosen, people get their questions after the name; no section headings anywhere', () => {
    const v = confirmationView({ ...base, summaryKeys: [], personKeys: [], shared: { programme: 'X', heading: 'x' } })
    expect(v.columns.map((c) => c.key)).toEqual(['designation', 'aadhaar'])
    expect(v.summary.map((x) => x.f.key)).toEqual(['programme'])
  })

  it('a person without a name is called by their place, in the reader’s words', () => {
    const v = confirmationView({ ...base, summaryKeys: [], personKeys: [], shared: {} })
    expect(v.personName({ name: '  ' }, 1)).toBe('Participant 2')
    expect(v.personName({ name: 'Anu' }, 0)).toBe('Anu')
  })

  it('the time is the business’s own, with its zone named', () => {
    // 20:00 UTC on the 29th is already the 30th in India.
    expect(submittedText('2026-10-29T20:00:00Z', 'en', 'Asia/Kolkata')).toMatch(/^30 October 2026.*1:30.*(GMT\+5:30|IST)/)
    expect(submittedText(null, 'en', 'Asia/Kolkata')).toBe('')
    expect(submittedText('2026-10-29T20:00:00Z', 'en', 'Not/AZone')).toBe('')
  })
})

describe('confirmation settings', () => {
  it('are off unless switched on, and keep only questions the table has', () => {
    expect(parseFormConfig({ enabled: true }).confirm_page.enabled).toBe(false)
    const c = parseFormConfig(
      { confirm_page: { enabled: true, title: '  Done  ', summary_keys: ['programme', 'gone', 5], person_keys: ['name'], show_time: false, ref_prefix: ' reg-26! ' } },
      ['programme', 'name'],
    ).confirm_page
    expect(c).toEqual({ enabled: true, title: 'Done', summary_keys: ['programme'], person_keys: ['name'], show_time: false, allow_print: true, ref_prefix: 'REG26' })
  })

  it('a prefix is letters and digits only, at most 8', () => {
    expect(parseFormConfig({ confirm_page: { ref_prefix: '<script>' } }).confirm_page.ref_prefix).toBe('SCRIPT')
    expect(parseFormConfig({ confirm_page: { ref_prefix: 'ABCDEFGHIJK' } }).confirm_page.ref_prefix).toBe('ABCDEFGH')
    expect(parseFormConfig({ confirm_page: { ref_prefix: '!!!' } }).confirm_page.ref_prefix).toBeNull()
  })

  it('the reference shows with the prefix, or alone', () => {
    expect(displayRef('7K2M-9QXD-R5TB', 'REG')).toBe('REG-7K2M-9QXD-R5TB')
    expect(displayRef('7K2M-9QXD-R5TB', null)).toBe('7K2M-9QXD-R5TB')
  })
})
