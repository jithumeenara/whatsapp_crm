import { beforeAll, describe, expect, it } from 'vitest'
import {
  cannotSend,
  cleanSetup,
  columnOf,
  corrections,
  fillText,
  inScope,
  maskValue,
  personView,
  templateValues,
  REF_HEADER,
} from './sheet-verify'
import { makeRef, normRef, readLink, signLink } from './sheet-verify-link'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= 'test-secret-for-verify'
})

const V = '11111111-1111-4111-8111-111111111111'
const headers = ['Name', 'WhatsApp No', 'Designation', 'Aadhaar No', 'Programme', 'Email', REF_HEADER]
const row = ['Anu S', '98470 12345', 'Secretary', '1234 5678 9012', 'Leadership', 'anu@example.com', 'AB12-CD34-EF56']
const setup = cleanSetup({
  name_column: 'Name',
  phone_column: 'WhatsApp No',
  email_column: 'Email',
  show_columns: ['Designation', 'Aadhaar No', 'Programme', 'WhatsApp No', REF_HEADER],
  edit_columns: ['Name', 'Designation', 'Aadhaar No', 'WhatsApp No', 'Not shown'],
})

describe('references', () => {
  it('are long, random and free of look-alike letters', () => {
    const refs = new Set(Array.from({ length: 200 }, makeRef))
    expect(refs.size).toBe(200)
    for (const r of refs) expect(r).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  })
  it('forgive case, spaces and look-alikes when typed', () => {
    expect(normRef(' ab1o-cdil ')).toBe('AB10CD11')
  })
})

describe('private links', () => {
  it('carry the claim and refuse any change to it', () => {
    const token = signLink({ v: V, r: 'AB12-CD34-EF56', k: 1 })
    expect(readLink(token)).toEqual({ v: V, r: 'AB12-CD34-EF56', k: 1 })
    const [payload, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify([V, 'ZZZZ-ZZZZ-ZZZZ', 1])).toString('base64url')
    expect(readLink(`${forged}.${mac}`)).toBeNull()
    expect(readLink(`${payload}.${mac.slice(0, -1)}A`)).toBeNull()
    expect(readLink(`${payload}`)).toBeNull()
    expect(readLink(123)).toBeNull()
    expect(readLink('a.b.c')).toBeNull()
  })
})

describe('what the person sees', () => {
  it('finds columns by header, whatever their case or spacing', () => {
    expect(columnOf(['  whatsapp   no '], 'WhatsApp No')).toBe(0)
    expect(columnOf(headers, 'Missing')).toBe(-1)
  })

  it('never lets a contact, reference or ID column be edited, nor one not shown', () => {
    expect(setup.edit_columns).toEqual(['Name', 'Designation'])
    expect(setup.show_columns).not.toContain(REF_HEADER)
  })

  it('shows their name and chosen columns, ID numbers and phone masked', () => {
    const view = personView(setup, headers, row)
    expect(view.map((v) => v.header)).toEqual(['Name', 'Designation', 'Aadhaar No', 'Programme', 'WhatsApp No'])
    expect(view.find((v) => v.header === 'Aadhaar No')?.value).toBe('••••••••9012')
    expect(view.find((v) => v.header === 'WhatsApp No')?.value).toBe('••••••2345')
    expect(view.find((v) => v.header === 'Aadhaar No')?.editable).toBe(false)
    expect(view.find((v) => v.header === 'Designation')?.editable).toBe(true)
    expect(JSON.stringify(view)).not.toContain('1234 5678 9012')
  })

  it('any phone-like column is masked and locked, not only the one messages go to', () => {
    const h = ['Name', 'Alternate Mobile', 'Parent phone']
    const s = cleanSetup({ name_column: 'Name', show_columns: ['Alternate Mobile', 'Parent phone'], edit_columns: ['Alternate Mobile', 'Parent phone'] })
    expect(s.edit_columns).toEqual([])
    const view = personView(s, h, ['Anu', '9847011111', '9847022222'])
    expect(view.map((v) => v.value)).toEqual(['Anu', '••••••1111', '••••••2222'])
  })

  it('a bank’s or society’s NAME can be seen and corrected; account numbers stay locked (bug: "Name of Bank" was masked)', () => {
    const h = ['Name', 'Name of Bank / Society', 'Bank Account No', 'IFSC', 'Designation']
    const s = cleanSetup({
      name_column: 'Name',
      show_columns: ['Name of Bank / Society', 'Bank Account No', 'IFSC', 'Designation'],
      edit_columns: ['Name of Bank / Society', 'Bank Account No', 'IFSC', 'Designation'],
    })
    expect(s.edit_columns).toEqual(['Name of Bank / Society', 'Designation'])
    const view = personView(s, h, ['Anu', 'Sample Service Co-op Bank', '123456789012', 'SBIN0001234', 'Secretary'])
    expect(view.find((v) => v.header === 'Name of Bank / Society')).toEqual({ header: 'Name of Bank / Society', value: 'Sample Service Co-op Bank', editable: true })
    expect(view.find((v) => v.header === 'Bank Account No')?.value).toBe('••••••••9012')
    expect(view.find((v) => v.header === 'IFSC')?.editable).toBe(false)
  })

  it('masks short and wordy values too', () => {
    expect(maskValue('123')).toBe('•••')
    expect(maskValue('secretword')).toBe('s••••••••d')
  })

  it('only rows in scope: the filter, and never an empty row', () => {
    const s = cleanSetup({ ...setup, filter_column: 'programme', filter_value: ' leadership ' })
    expect(inScope(s, headers, row)).toBe(true)
    expect(inScope(s, headers, [...row.slice(0, 4), 'Other'])).toBe(false)
    expect(inScope(setup, headers, ['', ' ', ''])).toBe(false)
  })
})

describe('corrections', () => {
  it('takes only real changes to editable columns, cleaned', () => {
    const r = corrections(setup, headers, row, { Name: '  Anu   S Nair\n', Designation: 'Secretary' }, { Name: 'Anu S', Designation: 'Secretary' })
    expect(r).toEqual({ ok: true, changes: [{ col: 0, header: 'Name', before: 'Anu S', after: 'Anu S Nair' }] })
  })

  it('refuses a column that may not be changed, an empty or too long answer', () => {
    expect(corrections(setup, headers, row, { 'Aadhaar No': '0000' }, {}).ok).toBe(false)
    expect(corrections(setup, headers, row, { 'WhatsApp No': '9000000000' }, {}).ok).toBe(false)
    expect(corrections(setup, headers, row, { Name: '   ' }, {}).ok).toBe(false)
    expect(corrections(setup, headers, row, { Name: 'x'.repeat(201) }, {}).ok).toBe(false)
    expect(corrections(setup, headers, row, { Name: 5 }, {}).ok).toBe(false)
    expect(corrections(setup, headers, row, null, {}).ok).toBe(false)
  })

  it('asks to reload when the sheet changed after the page was opened', () => {
    const r = corrections(setup, headers, row, { Name: 'Anu Nair' }, { Name: 'Anu' })
    expect(r).toMatchObject({ ok: false, stale: true })
  })

  it('a value starting with = is kept as text, not changed into anything else', () => {
    const r = corrections(setup, headers, row, { Designation: '=IMPORTXML("x")' }, {})
    expect(r).toMatchObject({ ok: true, changes: [{ after: '=IMPORTXML("x")' }] })
  })
})

describe('messages', () => {
  const values = { name: 'Anu S', link: 'https://crm.example/v/x', deadline: '5 Nov', business: 'Our Institute', ref: 'AB12-CD34-EF56' }
  it('fills a template from the business’s choices, never a sensitive column', () => {
    expect(templateValues(['name', 'link', 'col:Programme', 'col:Aadhaar No', 'col:Gone', 'nonsense'], values, headers, row))
      .toEqual(['Anu S', 'https://crm.example/v/x', 'Leadership', '-', '-', '-'])
  })
  it('fills an SMS or email text', () => {
    expect(fillText('Hi {{name}}, check {{ LINK }} by {{deadline}} – {{business}} ({{ref}}) {{other}}', values))
      .toBe('Hi Anu S, check https://crm.example/v/x by 5 Nov – Our Institute (AB12-CD34-EF56) {{other}}')
  })
  it('says why a row cannot be sent to', () => {
    expect(cannotSend('whatsapp', null)).toBe('No valid phone number')
    expect(cannotSend('email', 'nope')).toBe('Not an email address')
    expect(cannotSend('email', 'a@b.co')).toBeNull()
  })
})
