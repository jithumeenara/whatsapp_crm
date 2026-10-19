import { describe, expect, it } from 'vitest'
import {
  alignToHeaders, autoMatch, buildRow, cellMatches, checkConditions, matchRows, newestFirst, olderThan,
  parseSheetDate, pickSheetRows, relocate, rowVars, safeTabTitle, type SheetRow,
} from './sheet-rows'

const sheet = [
  ['Name', 'Mobile No.', 'Reg No', 'Date', 'Status'],
  ['Anu', '99478 40578', 'R-101', '01/10/2026', 'New'],
  ['Biju', '+91 9846012345', 'R-102', '15-Oct-2026', 'Paid'],
  ['', '', '', '', ''],
  ['Anu', '9947840578', 'R-103', '2026-10-18 14:30', 'New'],
]

function find(conds: Parameters<typeof checkConditions>[1], mode: 'all' | 'any' = 'all') {
  const c = checkConditions(sheet[0], conds)
  if ('error' in c) throw new Error(c.error)
  return matchRows(sheet, c.conditions, mode)
}

describe('finding rows by header name', () => {
  it('"is" with a phone compares the last ten digits, whatever the spacing or +91', () => {
    expect(find([{ column: 'mobile no.', op: 'equals', value: '+919947840578' }]).map((r) => r.row)).toEqual([2, 5])
    expect(cellMatches('9846012345', 'phone', '+91 98460-12345')).toBe(true)
  })

  it('matches column names in any case and spacing, values in any case', () => {
    expect(find([{ column: '  REG   no ', op: 'equals', value: 'r-102' }]).map((r) => r.row)).toEqual([3])
  })

  it('AND and OR', () => {
    expect(find([{ column: 'Name', op: 'equals', value: 'Anu' }, { column: 'Status', op: 'equals', value: 'Paid' }])).toHaveLength(0)
    expect(find([{ column: 'Name', op: 'equals', value: 'Anu' }, { column: 'Status', op: 'equals', value: 'Paid' }], 'any')).toHaveLength(3)
  })

  it('a column no longer in the sheet is said in words', () => {
    const c = checkConditions(sheet[0], [{ column: 'District', op: 'equals', value: 'x' }])
    expect('error' in c && c.error).toMatch(/District.*not in the sheet/)
  })

  it('an empty value (variable not set) matches nothing, never everything', () => {
    const c = checkConditions(sheet[0], [{ column: 'Reg No', op: 'equals', value: '  ' }])
    expect('error' in c ? null : c.nothing).toBe(true)
    expect(find([{ column: 'Reg No', op: 'equals', value: '' }])).toHaveLength(0)
  })

  it('skips blank rows', () => {
    expect(find([{ column: 'Name', op: 'empty', value: '' }])).toHaveLength(0)
  })
})

describe('dates as typed in sheets', () => {
  it('reads Indian day-first and ISO forms alike', () => {
    const oct18 = Date.UTC(2026, 9, 18)
    expect(parseSheetDate('18/10/2026')).toBe(oct18)
    expect(parseSheetDate('18-10-2026')).toBe(oct18)
    expect(parseSheetDate('18-Oct-2026')).toBe(oct18)
    expect(parseSheetDate('Oct 18, 2026')).toBe(oct18)
    expect(parseSheetDate('2026-10-18')).toBe(oct18)
    expect(parseSheetDate('05/10/2026')).toBe(Date.UTC(2026, 9, 5))
    expect(parseSheetDate('10/18/2026')).toBe(oct18)
    expect(parseSheetDate('18/10/2026 2:30 pm')).toBe(Date.UTC(2026, 9, 18, 14, 30))
  })
  it('null for what is not a date', () => {
    expect(parseSheetDate('R-101')).toBeNull()
    expect(parseSheetDate('31/02/2026')).toBeNull()
    expect(parseSheetDate('')).toBeNull()
  })
})

describe('which rows', () => {
  const rows: SheetRow[] = [
    { row: 2, values: ['a', '18/10/2026'] },
    { row: 3, values: ['b', '01/10/2026'] },
    { row: 4, values: ['c', 'soon'] },
  ]
  it('latest by date column; unreadable dates last', () => {
    expect(newestFirst(rows, 1).map((r) => r.row)).toEqual([2, 3, 4])
    expect(pickSheetRows(rows, 'latest', 1)[0].row).toBe(2)
    expect(pickSheetRows(rows, 'oldest', 1)[0].row).toBe(4)
  })
  it('latest by position when there is no date column', () => {
    expect(pickSheetRows(rows, 'latest', -1)[0].row).toBe(4)
  })
  it('older than N days', () => {
    expect(olderThan(rows, 1, 10, Date.UTC(2026, 9, 19)).map((r) => r.row)).toEqual([3])
  })
  it('never more than 20 at once', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ row: i + 2, values: ['x'] }))
    expect(pickSheetRows(many, 'all', -1)).toHaveLength(20)
  })
})

describe('relocate before writing', () => {
  const found: SheetRow[] = [{ row: 3, values: [...sheet[2]] }]
  it('keeps a row still where it was', () => {
    expect(relocate(found, sheet).rows[0].row).toBe(3)
  })
  it('follows a row someone moved (sorted, or a row above deleted)', () => {
    const moved = [sheet[0], sheet[1], sheet[4], ['Biju', '+91 9846012345', 'R-102', '15-Oct-2026', 'Paid']]
    const r = relocate([{ row: 3, values: sheet[2] }], moved)
    expect(r.rows.map((x) => x.row)).toEqual([4])
  })
  it('drops a row that changed meanwhile — never writes the wrong one', () => {
    const changed = sheet.map((r) => [...r])
    changed[2][4] = 'Refunded'
    const r = relocate([{ row: 3, values: sheet[2] }], changed)
    expect(r.rows).toHaveLength(0)
    expect(r.lost).toBe(1)
  })
})

describe('mapping', () => {
  it('places values by header name, reports columns gone, never wipes with an unset variable', () => {
    const out = buildRow(sheet[0], [
      { column: 'name', value: '{{vars.name}}' },
      { column: 'Status', value: '{{vars.unset}}' },
      { column: 'Gone', value: 'x' },
      { column: 'Date', value: '{{clear}}' },
    ], (t) => (t === '{{vars.name}}' ? 'Anu' : ''))
    expect(out.values).toEqual(['Anu', '', '', '', ''])
    expect([...out.cells.entries()]).toEqual([[0, 'Anu'], [3, '']])
    expect(out.missing).toEqual(['Gone'])
  })

  it('auto-matches by name and synonym, each option once', () => {
    const m = autoMatch(['Full Name', 'Mobile No.', 'Email ID', 'Date', 'CRM ID'], [
      { value: '{{contact.name}}', label: 'Contact name', keys: ['name'] },
      { value: '{{contact.phone}}', label: 'Contact phone', keys: ['phone'] },
      { value: '{{vars.email}}', label: 'email' },
      { value: '{{today}}', label: 'Today', keys: ['date'] },
    ])
    expect(m).toEqual({ 'Full Name': '{{contact.name}}', 'Mobile No.': '{{contact.phone}}', 'Email ID': '{{vars.email}}', Date: '{{today}}' })
  })

  it('row variables', () => {
    expect(rowVars(sheet[0], { row: 3, values: sheet[2] })).toMatchObject({ sheet_name: 'Biju', sheet_mobile_no: '+91 9846012345', sheet_row: '3' })
  })

  it('aligns to another tab and adds the columns it lacks', () => {
    expect(alignToHeaders(['Name', 'Status'], { Status: 'Paid', Name: 'Biju', 'Deleted at': 'now' })).toEqual({
      headers: ['Name', 'Status', 'Deleted at'], row: ['Biju', 'Paid', 'now'], added: ['Deleted at'],
    })
  })

  it('safe tab titles', () => {
    expect(safeTabTitle("Oct: Staff/Admin's [A]")).toBe('Oct Staff Admin’s A')
    expect(safeTabTitle('  ')).toBe('Others')
  })
})
