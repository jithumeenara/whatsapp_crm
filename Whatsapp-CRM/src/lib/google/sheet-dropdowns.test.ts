import { describe, expect, it } from 'vitest'
import { planDropdownUpdates, rangeFromFormula, rulesFromGrid } from './sheet-dropdowns'

describe('reading a sheet’s dropdowns', () => {
  it('finds a typed list and a range list, by column', () => {
    const grid = {
      sheets: [{ data: [{ startColumn: 0, rowData: [
        { values: [{}, {}] }, // header row, no rules
        { values: [
          { dataValidation: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Male' }, { userEnteredValue: 'Female' }, { userEnteredValue: 'Male' }] } } },
          { dataValidation: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: "='Lists'!$A$1:$A$14" }] } } },
        ] },
      ] }] }],
    }
    const rules = rulesFromGrid(grid)
    expect(rules.get(0)).toEqual({ list: ['Male', 'Female'] })
    expect(rules.get(1)).toEqual({ range: "'Lists'!A1:A14" })
  })

  it('ignores other kinds of rule (numbers, dates, checkboxes)', () => {
    const grid = { sheets: [{ data: [{ rowData: [{ values: [{ dataValidation: { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] } } }] }] }] }] }
    expect(rulesFromGrid(grid).size).toBe(0)
  })

  it('cleans a range formula', () => {
    expect(rangeFromFormula('=Sheet2!$B$2:$B$20')).toBe('Sheet2!B2:B20')
  })
})

describe('making the table’s dropdowns match', () => {
  const districts = ['Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam', 'Idukki', 'Kannur']

  it('fills an empty District dropdown with the sheet’s whole list', () => {
    const u = planDropdownUpdates({
      fields: [{ field_key: 'district', field_type: 'select', options: null }],
      columnKeys: ['name', 'district'],
      dropdowns: new Map([[1, districts]]),
      rows: [['Anu', 'Kannur']],
    })
    expect(u).toEqual([{ field_key: 'district', field_type: 'select', options: districts }])
  })

  it('turns a text column into a dropdown when the sheet has one, keeping choices it had', () => {
    const u = planDropdownUpdates({
      fields: [{ field_key: 'gender', field_type: 'text' }],
      columnKeys: ['gender'],
      dropdowns: new Map([[0, ['Male', 'Female']]]),
      rows: [],
    })
    expect(u).toEqual([{ field_key: 'gender', field_type: 'select', options: ['Male', 'Female'] }])
  })

  it('without a rule, gives an empty dropdown the values the column already holds', () => {
    const u = planDropdownUpdates({
      fields: [{ field_key: 'status', field_type: 'select', options: { select_items: [] } }],
      columnKeys: ['status'],
      dropdowns: new Map(),
      rows: [['Pending'], ['Confirmed'], ['pending'], ['']],
    })
    expect(u).toEqual([{ field_key: 'status', field_type: 'select', options: ['Pending', 'Confirmed'] }])
  })

  it('changes nothing that is already right, and never a number or date field', () => {
    expect(planDropdownUpdates({
      fields: [
        { field_key: 'g', field_type: 'select', options: { select_items: [{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }] } },
        { field_key: 'n', field_type: 'number' },
      ],
      columnKeys: ['g', 'n'],
      dropdowns: new Map([[0, ['Male', 'Female']], [1, ['1', '2']]]),
      rows: [],
    })).toEqual([])
  })
})
