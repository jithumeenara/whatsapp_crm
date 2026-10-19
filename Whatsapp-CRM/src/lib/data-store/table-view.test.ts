import { describe, expect, it } from 'vitest'
import { chipTone, initials, pageList, pickSubtitleField, pickTitleField, quickFilterFields, statCards, toCsv } from './table-view'
import type { DataField, DataRecord } from './types'

const f = (field_key: string, label: string, field_type: string, options?: unknown): DataField =>
  ({ id: field_key, field_key, label, field_type, options: options ?? null, sort_order: 0 }) as unknown as DataField
const fields = [
  f('month', 'month', 'select', [{ value: 'september', label: 'September' }, { value: 'october', label: 'October' }]),
  f('group', 'Target Group', 'text'),
  f('society', 'Name of Society', 'text'),
  f('name', 'Name of Participant', 'text'),
  f('desig', 'Designation', 'text'),
  f('district', 'District', 'district'),
]
const rec = (id: string, data: Record<string, unknown>) => ({ id, data, created_at: '2026-10-01T00:00:00Z' }) as unknown as DataRecord
const rows = [
  rec('1', { month: 'september', group: 'Sub-staff', name: 'Faisal A', district: 'Malappuram' }),
  rec('2', { month: 'september', group: 'Sub-staff', name: 'Remesh P.', district: 'Malappuram' }),
  rec('3', { month: 'october', group: 'Supervisory Cadre', name: 'Suresh M. K', district: 'Kozhikode' }),
]

describe('what a row is called', () => {
  it('a name-like field, not the society or bank name', () => {
    expect(pickTitleField(fields, rows)?.field_key).toBe('name')
    expect(pickSubtitleField(fields, pickTitleField(fields, rows))?.field_key).toBe('group')
  })
  it('the most-filled text field when nothing is called a name', () => {
    const t = [f('code', 'Code', 'text'), f('item', 'Item', 'text')]
    expect(pickTitleField(t, [rec('1', { item: 'Rice' }), rec('2', { item: 'Dal' })])?.field_key).toBe('item')
  })
  it('initials', () => {
    expect(initials('Faisal A')).toBe('FA')
    expect(initials('muhammed shareef t t')).toBe('MT')
    expect(initials('ഫൈസൽ')).toBe('ഫ')
    expect(initials('')).toBe('?')
  })
})

describe('stat cards and quick filters', () => {
  it('total, the two biggest groups of the first grouping column, and a spread count', () => {
    const cards = statCards(fields, rows)
    expect(cards.map((c) => [c.label, c.value])).toEqual([['Total', 3], ['September', 2], ['October', 1], ['Districts', 2]])
    expect(cards[1].filter).toEqual({ field_key: 'month', value: 'september' })
  })
  it('an empty table shows only the total', () => {
    expect(statCards(fields, [])).toEqual([{ key: 'total', label: 'Total', value: 0, tone: 'total' }])
  })
  it('quick filters are the choice columns with a few values', () => {
    expect(quickFilterFields(fields, rows).map((x) => x.field_key)).toEqual(['month', 'group', 'district'])
  })
})

describe('export and pages', () => {
  it('CSV quotes every cell, keeps Malayalam, never lets a cell run as a formula', () => {
    const csv = toCsv(['Name', 'Note'], [['ഫൈസൽ', 'said "hi"'], ['=HYPERLINK("x")', '+91 9947']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"ഫൈസൽ","said ""hi"""')
    expect(csv).toContain(`"'=HYPERLINK(""x"")","'+91 9947"`)
  })
  it('page buttons stay short', () => {
    expect(pageList(1, 3)).toEqual([1, 2, 3])
    expect(pageList(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20])
  })
  it('the same value always gets the same colour', () => {
    expect(chipTone('September')).toBe(chipTone(' september'))
  })
})

describe('chips', () => {
  it('a category column is a chip; a column different in most rows is not', async () => {
    const { chipFieldKeys } = await import('./table-view')
    const many = Array.from({ length: 9 }, (_, i) => rec(String(i), { group: i < 5 ? 'Sub-staff' : 'Supervisory Cadre', desig: ['Peon', 'Driver', 'Clerk', 'Manager', 'Secretary', 'Director', 'Peon', 'Accountant', 'Attender'][i], month: 'september' }))
    const keys = chipFieldKeys(fields, many)
    expect(keys.has('group')).toBe(true)
    expect(keys.has('desig')).toBe(false)
    expect(keys.has('month')).toBe(true)
  })
})
