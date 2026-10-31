import { describe, expect, it } from 'vitest'
import { corrections, personView, type RowDropdowns, type VerifySetup } from './sheet-verify'
import { dropdownRule } from '@/lib/google/sheets'
import { pickBrandForm } from './verify-brand'

/**
 * A column with a dropdown in the Google Sheet is corrected from that same
 * list on the person's page, and the server holds to it when the sheet
 * rejects other values.
 */

const SETUP = {
  name_column: 'Name', phone_column: 'Phone', email_column: null,
  show_columns: ['Designation', 'Bank'], edit_columns: ['Name', 'Designation'],
  filter_column: null, filter_value: null,
} as unknown as VerifySetup
const HEADERS = ['Name', 'Phone', 'Designation', 'Bank']
const ROW = ['Anu S', '9847012345', 'Clerk', 'Canara Bank']
const LIST = ['Clerk', 'Manager', 'Secretary']

const drop = (strict: boolean): RowDropdowns => new Map([[2, { options: LIST, strict }], [3, { options: ['SBI', 'Canara Bank'], strict: true }]])

describe('dropdown rules read from the sheet', () => {
  it('a "list of items" rule gives its items, cleaned and in order', () => {
    expect(dropdownRule({ condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: ' Clerk ' }, { userEnteredValue: 'clerk' }, { userEnteredValue: '' }, { userEnteredValue: 'Manager' }] }, strict: true }))
      .toEqual({ options: ['Clerk', 'Manager'], strict: true })
  })
  it('a "list from a range" rule gives the range to read', () => {
    expect(dropdownRule({ condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Lists!$A$2:$A$40' }] } }))
      .toEqual({ range: 'Lists!$A$2:$A$40', strict: false })
  })
  it('other rules (numbers, dates, checkboxes) are not dropdowns', () => {
    expect(dropdownRule({ condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '5' }] } })).toBeNull()
    expect(dropdownRule({ condition: { type: 'BOOLEAN' } })).toBeNull()
    expect(dropdownRule(undefined)).toBeNull()
  })
})

describe('the person’s page', () => {
  it('offers the list only on columns they may correct', () => {
    const items = personView(SETUP, HEADERS, ROW, drop(true))
    expect(items.find((i) => i.header === 'Designation')?.options).toEqual(LIST)
    // Bank has a dropdown in the sheet but is not editable here.
    expect(items.find((i) => i.header === 'Bank')?.options).toBeUndefined()
    expect(items.find((i) => i.header === 'Name')?.options).toBeUndefined()
  })
})

describe('a correction to a dropdown column', () => {
  it('takes a listed item, written exactly as the list has it', () => {
    const r = corrections(SETUP, HEADERS, ROW, { Designation: 'manager' }, {}, drop(true))
    expect(r).toEqual({ ok: true, changes: [{ col: 2, header: 'Designation', before: 'Clerk', after: 'Manager' }] })
  })
  it('refuses a value not on a strict list', () => {
    const r = corrections(SETUP, HEADERS, ROW, { Designation: 'Chief Wizard' }, {}, drop(true))
    expect(r.ok).toBe(false)
  })
  it('allows another value when the sheet only warns', () => {
    const r = corrections(SETUP, HEADERS, ROW, { Designation: 'Chief Wizard' }, {}, drop(false))
    expect(r).toMatchObject({ ok: true, changes: [{ after: 'Chief Wizard' }] })
  })
  it('a column without a dropdown stays free text', () => {
    const r = corrections(SETUP, HEADERS, ROW, { Name: 'Anu S Nair' }, {}, drop(true))
    expect(r).toMatchObject({ ok: true, changes: [{ after: 'Anu S Nair' }] })
  })
})

describe('the look borrowed from the business’s public form', () => {
  const at = (d: number) => new Date(2026, 9, d)
  it('prefers a switched-on form whose look was set, then the latest', () => {
    const pick = pickBrandForm([
      { form_token: 'plain-new', form_config: { enabled: true, brand: {} }, updated_at: at(30) },
      { form_token: 'teal', form_config: { enabled: true, brand: { color: 'teal', tagline: 'Training Registration' } }, updated_at: at(10) },
      { form_token: 'off', form_config: { enabled: false, brand: { color: 'rose' } }, updated_at: at(31) },
    ])
    expect(pick?.token).toBe('teal')
    expect(pick?.brand.color).toBe('teal')
  })
  it('no switched-on form means the plain look', () => {
    expect(pickBrandForm([{ form_token: 'off', form_config: { enabled: false }, updated_at: at(1) }])).toBeNull()
    expect(pickBrandForm([])).toBeNull()
  })
})
