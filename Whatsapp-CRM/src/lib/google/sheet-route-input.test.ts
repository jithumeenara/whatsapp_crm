import { describe, expect, it } from 'vitest'
import { parseAiRule, parseRuleInput } from './sheet-route-input'

const fields = [
  { field_key: 'group', label: 'Target group', field_type: 'select', options: [{ value: 'sup', label: 'Supervisory Staff' }] },
  { field_key: 'date', label: 'Programme date', field_type: 'date' },
]
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'

describe('rule input from the screen', () => {
  it('keeps only real fields and operators, copies nothing else', () => {
    const r = parseRuleInput({
      name: ' Supervisory Oct ', spreadsheet_id: SHEET, account_id: 'evil', delivered_count: 999,
      conditions: [{ field_key: 'group', op: 'is', value: 'Supervisory Staff' }, { field_key: 'nope', op: 'is', value: 'x' }, { field_key: 'date', op: 'drop table', value: 'x' }],
      columns: [{ field_key: 'group', header: 'Group' }, { field_key: 'ghost', header: 'G' }],
    }, fields)
    expect('rule' in r && r.rule).toMatchObject({
      name: 'Supervisory Oct', match: 'all', tab_title: 'Sheet1', split_into: 'tab', move_on_edit: true,
      conditions: [{ field_key: 'group', op: 'is', value: 'Supervisory Staff' }],
      columns: [{ field_key: 'group', header: 'Group' }],
    })
    expect(JSON.stringify(r)).not.toMatch(/evil|999/)
  })
  it('says what is missing', () => {
    expect(parseRuleInput({ spreadsheet_id: SHEET }, fields)).toEqual({ error: 'Give the rule a name.' })
    expect(parseRuleInput({ name: 'x', spreadsheet_id: 'not a sheet' }, fields)).toEqual({ error: 'Choose the Google Sheet the rows go to.' })
    expect(parseRuleInput({ name: 'x', spreadsheet_id: SHEET, conditions: [{ field_key: 'group', op: 'is', value: '' }] }, fields)).toEqual({ error: 'A condition has no value.' })
    expect(parseRuleInput({ name: 'x', spreadsheet_id: SHEET, split_template: 'Month' }, fields)).toMatchObject({ error: expect.stringMatching(/\{\{Field\}\}/) })
  })
  it('a fallback rule has no conditions', () => {
    const r = parseRuleInput({ name: 'Others', spreadsheet_id: SHEET, is_fallback: true, conditions: [{ field_key: 'group', op: 'is', value: 'x' }] }, fields)
    expect('rule' in r && r.rule.conditions).toEqual([])
  })
})

describe('a rule from plain words (AI answer checked)', () => {
  it('accepts a clean answer, even in a code fence', () => {
    const d = parseAiRule('```json\n{"name":"Supervisory Staff – October","match":"all","conditions":[{"field_key":"group","op":"is","value":"Supervisory Staff"},{"field_key":"date","op":"in_month","value":"October"}],"split_template":null,"tab_title":"Oct Supervisory"}\n```', fields)
    expect(d).toMatchObject({ name: 'Supervisory Staff – October', tab_title: 'Oct Supervisory', dropped: 0 })
    expect(d?.conditions).toHaveLength(2)
  })
  it('drops invented fields and says how many', () => {
    const d = parseAiRule('{"name":"x","conditions":[{"field_key":"district","op":"is","value":"Kochi"}],"split_template":"Month"}', fields)
    expect(d).toMatchObject({ conditions: [], dropped: 1, split_template: null })
  })
  it('null for prose', () => {
    expect(parseAiRule('Sorry, I cannot help with that.', fields)).toBeNull()
  })
})

describe('columns matched to a template sheet', () => {
  it('keeps Serial number and Date added, in the sheet’s order, under the sheet’s own names', () => {
    const r = parseRuleInput({ name: 'x', spreadsheet_id: SHEET, columns: [
      { field_key: '__serial', header: 'Sl No.' }, { field_key: 'group', header: 'Designation' }, { field_key: '__created', header: 'Date' }, { field_key: '__evil', header: 'x' },
    ] }, fields)
    expect('rule' in r && r.rule.columns).toEqual([
      { field_key: '__serial', header: 'Sl No.' }, { field_key: 'group', header: 'Designation' }, { field_key: '__created', header: 'Date' },
    ])
  })
})

describe('fixed text columns', () => {
  it('keeps a fixed column with its text, drops one without text', () => {
    const r = parseRuleInput({ name: 'x', spreadsheet_id: SHEET, columns: [
      { field_key: '__fixed', header: 'Gender', value: ' Male ' }, { field_key: '__fixed', header: 'Status', value: '' },
    ] }, fields)
    expect('rule' in r && r.rule.columns).toEqual([{ field_key: '__fixed', header: 'Gender', value: 'Male' }])
  })
})
