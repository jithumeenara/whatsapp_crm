import { describe, it, expect } from 'vitest'
import {
  parseBrand,
  parseRules,
  isShown,
  optionsFor,
  fillValue,
  columnsNeeded,
  pipeAnswers,
  sameName,
  suggestRules,
  type FormLookups,
} from './form-logic'

const KEYS = ['month', 'programme', 'from_date', 'to_date', 'target', 'reason']

const rules = parseRules(
  {
    programme: { filter: { depends_on: 'month', match_column: 'month' } },
    from_date: { fill: { from_field: 'programme', column: 'date_from', locked: true } },
    to_date: { fill: { from_field: 'programme', column: 'date_to' } },
    target: { fill: { from_field: 'programme', column: 'target_group', locked: false } },
    reason: { show_if: { field: 'month', equals: 'october' } },
  },
  KEYS,
)

const lookups: FormLookups = {
  programme: {
    option: 'name',
    rows: [
      { name: 'STP (M)', month: 'October', date_from: '2026-10-05', date_to: '2026-10-09', target_group: 'Sub-staff' },
      { name: 'Gold loan appraisal', month: 'October', date_from: '2026-10-12', date_to: '2026-10-13', target_group: 'Clerks' },
      { name: 'STP (SV)', month: 'September', date_from: '2026-09-29', date_to: '2026-10-01', target_group: 'Supervisors' },
    ],
  },
}

describe('form rules', () => {
  it('keeps only rules that look at an earlier question', () => {
    const r = parseRules(
      {
        month: { filter: { depends_on: 'programme', match_column: 'x' } },
        programme: { fill: { from_field: 'nope', column: 'x' } },
        target: { show_if: { field: 'month', equals: ' ' } },
        from_date: { fill: { from_field: 'programme', column: 'bad column!' } },
        ghost: { show_if: { field: 'month', equals: 'x' } },
      },
      KEYS,
    )
    expect(r).toEqual({})
  })

  it('locks a filled field unless told otherwise', () => {
    expect(rules.from_date.fill?.locked).toBe(true)
    expect(rules.to_date.fill?.locked).toBe(true)
    expect(rules.target.fill?.locked).toBe(false)
  })

  it('narrows a dropdown to the rows matching an earlier answer', () => {
    expect(optionsFor('programme', rules, lookups, { month: 'october' })).toEqual(['STP (M)', 'Gold loan appraisal'])
    expect(optionsFor('programme', rules, lookups, { month: ' SEPTEMBER ' })).toEqual(['STP (SV)'])
    // Nothing answered yet: everything.
    expect(optionsFor('programme', rules, lookups, {})).toHaveLength(3)
    // A dropdown with no filter keeps its own options.
    expect(optionsFor('month', rules, lookups, {})).toBeNull()
  })

  it('fills from the row that was picked', () => {
    const answers = { month: 'October', programme: 'Gold loan appraisal' }
    expect(fillValue('from_date', rules, lookups, answers)).toBe('2026-10-12')
    expect(fillValue('target', rules, lookups, answers)).toBe('Clerks')
    expect(fillValue('from_date', rules, lookups, { month: 'October' })).toBeNull()
    // A pick that does not fit the filter finds nothing.
    expect(fillValue('from_date', rules, lookups, { month: 'September', programme: 'Gold loan appraisal' })).toBe('')
  })

  it('shows a question only when its condition holds, including through a hidden one', () => {
    expect(isShown('reason', rules, { month: 'October' })).toBe(true)
    expect(isShown('reason', rules, { month: 'September' })).toBe(false)
    expect(isShown('month', rules, {})).toBe(true)
    const chained = parseRules(
      { programme: { show_if: { field: 'month', equals: 'x' } }, target: { show_if: { field: 'programme', equals: 'y' } } },
      KEYS,
    )
    expect(isShown('target', chained, { month: 'z', programme: 'y' })).toBe(false)
  })

  it('carries only the columns the rules use', () => {
    expect(columnsNeeded('programme', rules, 'name').sort()).toEqual(['date_from', 'date_to', 'month', 'name', 'target_group'])
  })

  it('puts answers into the thank-you message', () => {
    expect(pipeAnswers('Thanks {{name}}, see you on {{ from_date }}. {{missing}}', { name: 'Anu', from_date: '12 Oct' })).toBe(
      'Thanks Anu, see you on 12 Oct. ',
    )
  })
})

describe('linking fields automatically', () => {
  // The Training Registration table and its Training source, as named.
  const questions = [
    { key: 'month', label: 'month' },
    { key: 'training_programe', label: 'Training Programe' },
    { key: 'target_group', label: 'Target Group' },
    { key: 'from_date', label: 'From Date' },
    { key: 'to_date', label: 'To Date' },
    { key: 'name_of_participant', label: 'Name of Participant' },
  ]
  const sources = [
    {
      field_key: 'training_programe',
      table_name: 'Training',
      option_column: 'name_of_programme',
      columns: [
        { key: 'name_of_programme', label: 'Name of programme' },
        { key: 'target_group', label: 'Target group' },
        { key: 'month', label: 'Month' },
        { key: 'date_from', label: 'Date from' },
        { key: 'date_to', label: 'Date To' },
        { key: 'fee', label: 'Fee' },
      ],
    },
  ]

  it('matches names in any order and case', () => {
    expect(sameName('From Date', 'Date from')).toBe(true)
    expect(sameName('Target Group', 'target_group')).toBe(true)
    expect(sameName('month', 'Month')).toBe(true)
    expect(sameName('To Date', 'Date To')).toBe(true)
    expect(sameName('From Date', 'Date To')).toBe(false)
    expect(sameName('', '')).toBe(false)
  })

  it('links month → programme → group and dates, locked', () => {
    const { rules, added } = suggestRules(questions, sources, {})
    expect(rules.training_programe.filter).toEqual({ depends_on: 'month', match_column: 'month' })
    expect(rules.target_group.fill).toEqual({ from_field: 'training_programe', column: 'target_group', locked: true })
    expect(rules.from_date.fill).toEqual({ from_field: 'training_programe', column: 'date_from', locked: true })
    expect(rules.to_date.fill).toEqual({ from_field: 'training_programe', column: 'date_to', locked: true })
    expect(rules.name_of_participant).toBeUndefined()
    expect(added).toHaveLength(4)
  })

  it('keeps what was already set', () => {
    const existing = parseRules({ from_date: { fill: { from_field: 'training_programe', column: 'fee', locked: false } } }, questions.map((q) => q.key))
    const { rules } = suggestRules(questions, sources, existing)
    expect(rules.from_date.fill).toEqual({ from_field: 'training_programe', column: 'fee', locked: false })
  })

  it('never links a question to one after it', () => {
    const reversed = [questions[1], questions[0], ...questions.slice(2)]
    expect(suggestRules(reversed, sources, {}).rules.training_programe?.filter ?? null).toBeNull()
  })
})

describe('brand', () => {
  it('reads only what is valid', () => {
    expect(parseBrand({ logo_file_id: '../etc/passwd', color: 'hotpink', name: '  ACSTI  ', show_contact: false })).toEqual({
      logo_file_id: null,
      name: 'ACSTI',
      tagline: null,
      color: 'green',
      show_contact: false,
    })
  })
})
