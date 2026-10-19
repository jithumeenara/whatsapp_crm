import { describe, expect, it } from 'vitest'
import {
  chooseRules, conditionHolds, describeConditions, destinationsFor, planTabWrite, previewRouting, renderGroup, ruleHeaders, type RouteField, type RouteRecord, type RouteRule,
} from './sheet-route-rules'

const fields: RouteField[] = [
  { field_key: 'name', label: 'Name', field_type: 'text' },
  { field_key: 'group', label: 'Target group', field_type: 'select', options: [{ value: 'sup', label: 'Supervisory Staff' }, { value: 'off', label: 'Officers' }] },
  { field_key: 'month', label: 'Month', field_type: 'select', options: [{ value: 'October', label: 'October' }] },
  { field_key: 'date', label: 'Programme date', field_type: 'date' },
  { field_key: 'fee', label: 'Fee', field_type: 'number' },
  { field_key: 'langs', label: 'Languages', field_type: 'multiselect' },
  { field_key: 'pw', label: 'Password', field_type: 'password' },
]
const fmap = new Map(fields.map((f) => [f.field_key, f]))
const now = Date.UTC(2026, 9, 19)
const rec = (data: Record<string, unknown>, id = 'r1'): RouteRecord => ({ id, data, created_at: '2026-10-05T10:00:00Z' })
const rule = (r: Partial<RouteRule>): RouteRule => ({
  id: r.id ?? 'x', name: r.name ?? 'Rule', enabled: true, is_fallback: false, match: 'all', conditions: [],
  spreadsheet_id: 'S1', tab_title: 'Sheet1', split_template: null, split_into: 'tab', columns: [], ...r,
})

describe('conditions', () => {
  const r = rec({ name: 'Anu', group: 'sup', month: 'October', date: '2026-10-18', fee: '1,500', langs: ['ml', 'en'] })
  it('a select matches by its label or its stored value, any case', () => {
    expect(conditionHolds({ field_key: 'group', op: 'is', value: 'supervisory staff' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'group', op: 'is', value: 'sup' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'group', op: 'is_not', value: 'Supervisory Staff' }, r, fmap, now)).toBe(false)
  })
  it('is one of, multiselect, contains', () => {
    expect(conditionHolds({ field_key: 'group', op: 'one_of', value: 'Officers, Supervisory Staff' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'langs', op: 'is', value: 'en' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'name', op: 'contains', value: 'nu' }, r, fmap, now)).toBe(true)
  })
  it('month: from a date, a month-name field, this/last month', () => {
    expect(conditionHolds({ field_key: 'date', op: 'in_month', value: 'October' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'date', op: 'in_month', value: '2026-10' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'date', op: 'in_month', value: 'this_month' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'date', op: 'in_month', value: 'last_month' }, r, fmap, now)).toBe(false)
    expect(conditionHolds({ field_key: 'month', op: 'in_month', value: 'Oct' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: '__created', op: 'in_month', value: 'October' }, r, fmap, now)).toBe(true)
  })
  it('numbers and date ranges (end date inclusive)', () => {
    expect(conditionHolds({ field_key: 'fee', op: 'gt', value: '1000' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'fee', op: 'lt', value: '1000' }, r, fmap, now)).toBe(false)
    expect(conditionHolds({ field_key: 'date', op: 'date_between', value: '01/10/2026', value2: '18/10/2026' }, r, fmap, now)).toBe(true)
    expect(conditionHolds({ field_key: 'date', op: 'date_between', value: '19/10/2026', value2: '' }, r, fmap, now)).toBe(false)
  })
  it('empty "is" matches nothing', () => {
    expect(conditionHolds({ field_key: 'name', op: 'is', value: '' }, r, fmap, now)).toBe(false)
  })
})

describe('choosing rules', () => {
  const sup = rule({ id: 'sup', name: 'Supervisory in October', conditions: [{ field_key: 'group', op: 'is', value: 'Supervisory Staff' }, { field_key: 'date', op: 'in_month', value: 'October' }] })
  const oct = rule({ id: 'oct', name: 'All October', conditions: [{ field_key: 'date', op: 'in_month', value: 'October' }] })
  const others = rule({ id: 'others', name: 'Others', is_fallback: true })
  const rules = [sup, oct, others]
  it('first match only / every match', () => {
    const r = rec({ group: 'sup', date: '2026-10-02' })
    expect(chooseRules(rules, r, fmap, 'first', now).map((x) => x.id)).toEqual(['sup'])
    expect(chooseRules(rules, r, fmap, 'all', now).map((x) => x.id)).toEqual(['sup', 'oct'])
  })
  it('a row no rule wants goes to "Others", never nowhere', () => {
    expect(chooseRules(rules, rec({ group: 'off', date: '2026-11-02' }), fmap, 'all', now).map((x) => x.id)).toEqual(['others'])
  })
  it('a switched-off rule is skipped', () => {
    expect(chooseRules([{ ...sup, enabled: false }, oct], rec({ group: 'sup', date: '2026-10-02' }), fmap, 'first', now).map((x) => x.id)).toEqual(['oct'])
  })
})

describe('auto-split names', () => {
  it('"{{Programme date|month}} – {{Target group}}" uses labels, not codes', () => {
    expect(renderGroup('{{Programme date|month}} – {{Target group}}', rec({ date: '2026-10-18', group: 'sup' }), fields)).toBe('Oct 2026 – Supervisory Staff')
    expect(renderGroup('{{created|monthname}}', rec({}), fields)).toBe('October')
    expect(renderGroup('{{Target group}}', rec({}), fields)).toBe('(blank)')
  })
  it('a split rule sends each group to its own tab', () => {
    const r = rule({ split_template: '{{Target group}}' })
    const [d] = destinationsFor({ rules: [r], rec: rec({ group: 'off', name: 'B' }), fields, mode: 'first', nowWall: now })
    expect(d.tab).toBe('Officers')
    expect(d.spreadsheet_id).toBe('S1')
  })
})

describe('columns', () => {
  it('chosen columns in order, then CRM ID; never a password', () => {
    expect(ruleHeaders(rule({ columns: [{ field_key: 'fee', header: 'Amount' }, { field_key: 'name', header: 'Name' }, { field_key: 'pw', header: 'P' }] }), fields).headers)
      .toEqual(['Amount', 'Name', 'CRM ID'])
    expect(ruleHeaders(rule({}), fields).headers).not.toContain('Password')
  })
  it('row values show labels and carry the record id', () => {
    const [d] = destinationsFor({ rules: [rule({ columns: [{ field_key: 'group', header: 'Group' }, { field_key: 'langs', header: 'Langs' }] })], rec: rec({ group: 'sup', langs: ['ml', 'en'] }, 'R9'), fields, mode: 'first', nowWall: now })
    expect(d.row).toEqual(['Supervisory Staff', 'ml, en', 'R9'])
  })
  it('the hash changes when the row does', () => {
    const r = rule({})
    const a = destinationsFor({ rules: [r], rec: rec({ name: 'A' }), fields, mode: 'first', nowWall: now })[0].hash
    const b = destinationsFor({ rules: [r], rec: rec({ name: 'B' }), fields, mode: 'first', nowWall: now })[0].hash
    expect(a).not.toBe(b)
  })
})

describe('preview', () => {
  it('counts per destination and rows going nowhere', () => {
    const rules = [rule({ id: 'a', name: 'Officers', conditions: [{ field_key: 'group', op: 'is', value: 'Officers' }], split_template: '{{Programme date|month}}' })]
    const p = previewRouting({ rules, records: [rec({ group: 'off', date: '2026-10-01' }, '1'), rec({ group: 'off', date: '2026-10-09' }, '2'), rec({ group: 'sup' }, '3')], fields, mode: 'first', nowWall: now })
    expect(p).toEqual({ total: 3, nowhere: 1, destinations: [{ rule_id: 'a', rule: 'Officers', place: 'Tab “Oct 2026”', count: 2 }] })
  })
  it('describes a rule in words', () => {
    expect(describeConditions([{ field_key: 'group', op: 'is', value: 'Supervisory Staff' }, { field_key: 'date', op: 'in_month', value: 'this_month' }], 'all', fields))
      .toBe('Target group is “Supervisory Staff” and Programme date is in “this month”')
  })
})


describe('writing a tab by CRM ID', () => {
  const tab = [
    ['Name', 'Status', 'CRM ID'],
    ['Anu', 'New', 'r1'],
    ['Biju', 'New', 'r2'],
  ]
  it('updates the row with that CRM ID wherever it is now, appends new ones, deletes moved ones', () => {
    const sorted = [tab[0], tab[2], tab[1]]
    const w = planTabWrite(sorted, [
      { id: 'r1', headers: ['Name', 'Status', 'CRM ID'], row: ['Anu', 'Paid', 'r1'] },
      { id: 'r3', headers: ['Name', 'Status', 'CRM ID'], row: ['Chinnu', 'New', 'r3'] },
    ], ['r2'])
    expect(w.cells).toEqual([{ row: 3, col: 1, value: 'Paid' }])
    expect(w.appends).toEqual([['Chinnu', 'New', 'r3']])
    expect(w.deletes).toEqual([2])
    expect(w.header).toBeNull()
    expect(w.added).toEqual(['r3'])
  })
  it('columns moved in the sheet are still found by name; missing ones are added at the end', () => {
    const moved = [['CRM ID', 'Name'], ['r1', 'Anu']]
    const w = planTabWrite(moved, [{ id: 'r1', headers: ['Name', 'Fee', 'CRM ID'], row: ['Anu', '500', 'r1'] }], [])
    expect(w.header).toEqual(['CRM ID', 'Name', 'Fee'])
    expect(w.cells).toEqual([{ row: 2, col: 2, value: '500' }])
  })
  it('an empty tab gets the header row', () => {
    const w = planTabWrite([], [{ id: 'r1', headers: ['Name', 'CRM ID'], row: ['Anu', 'r1'] }], [])
    expect(w.header).toEqual(['Name', 'CRM ID'])
    expect(w.appends).toEqual([['Anu', 'r1']])
  })
  it('running it again changes nothing (idempotent — retries never duplicate)', () => {
    const w = planTabWrite(tab, [{ id: 'r1', headers: ['Name', 'Status', 'CRM ID'], row: ['Anu', 'New', 'r1'] }], [])
    expect(w).toEqual({ header: null, cells: [], appends: [], deletes: [], added: [] })
  })
})
