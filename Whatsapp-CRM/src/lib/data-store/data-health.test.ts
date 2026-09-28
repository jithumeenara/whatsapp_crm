import { describe, it, expect } from 'vitest'
import { findHealthIssues, mergeChanges, monthFixChanges, valueKey, type HealthField, type HealthRow } from './data-health'

const FIELDS: HealthField[] = [
  { field_key: 'name', label: 'Name of programme', field_type: 'select', required: true },
  { field_key: 'group', label: 'Target group', field_type: 'text', required: false },
  { field_key: 'month', label: 'Month', field_type: 'select', required: false, options: ['september', 'october'] },
  { field_key: 'from', label: 'Date from', field_type: 'date', required: false },
]

const ROWS: HealthRow[] = [
  { id: '1', data: { name: 'STP (S)', group: 'Sub-staff', month: 'september', from: '2026-09-29' } },
  { id: '2', data: { name: 'STP (M)', group: 'Sub staff', month: 'october', from: '2026-10-12' } },
  { id: '3', data: { name: 'Gold loan', group: 'sub-staff', month: 'september', from: '2026-10-16' } },
  { id: '4', data: { name: '', group: 'All staff', month: 'Oct', from: '16/10/2026x' } },
]

describe('finding what makes answers wrong', () => {
  const issues = findHealthIssues(FIELDS, ROWS)

  it('groups one value spelt several ways, keeping the common or listed one', () => {
    const groups = issues.find((i) => i.kind === 'spellings' && i.field_key === 'group')
    expect(groups).toMatchObject({ groups: [{ keep: 'Sub-staff', others: [{ value: 'Sub staff' }, { value: 'sub-staff' }] }] })
    const months = issues.find((i) => i.kind === 'spellings' && i.field_key === 'month')
    expect(months).toMatchObject({ groups: [{ keep: 'october', others: [{ value: 'Oct', rows: 1 }] }] })
  })

  it('never groups values that are only alike', () => {
    expect(valueKey('STP (S)')).not.toBe(valueKey('STP (M)'))
    expect(issues.some((i) => i.kind === 'spellings' && i.field_key === 'name')).toBe(false)
  })

  it('finds a month that disagrees with its own date', () => {
    expect(issues.find((i) => i.kind === 'month_mismatch')).toMatchObject({
      field_key: 'month',
      date_label: 'Date from',
      rows: [{ id: '3', value: 'september', should_be: 'october' }],
    })
  })

  it('finds unreadable dates and empty required cells', () => {
    expect(issues.find((i) => i.kind === 'unreadable_dates')).toMatchObject({ field_key: 'from', count: 1 })
    expect(issues.find((i) => i.kind === 'empty_required')).toMatchObject({ field_key: 'name', count: 1 })
  })
})

describe('fixing', () => {
  it('merges only spellings of the same value', () => {
    const changes = mergeChanges(FIELDS[1], ROWS, ['Sub staff', 'sub-staff', 'All staff'], 'Sub-staff')
    expect(changes.map((c) => c.id)).toEqual(['2', '3'])
    expect(changes[0].data.group).toBe('Sub-staff')
  })

  it('sets a wrong month from the row\'s date, in the column\'s own spelling', () => {
    expect(monthFixChanges(FIELDS, ROWS, 'month')).toEqual([{ id: '3', data: { ...ROWS[2].data, month: 'october' } }])
  })
})
