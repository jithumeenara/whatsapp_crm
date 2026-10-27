import { describe, expect, it } from 'vitest'
import { runSheetStep, businessNow, withDateTokens, type SheetsApi, type SheetStepConfig } from './sheet-step'

/** A spreadsheet in memory, behaving as Google does for these calls. */
function fakeSheet(initial: Record<string, string[][]>) {
  const tabs = new Map<string, { sheetId: number; rows: string[][] }>()
  let gid = 0
  for (const [t, rows] of Object.entries(initial)) tabs.set(t, { sheetId: gid++, rows: rows.map((r) => [...r]) })
  const calls: string[] = []
  let beforeSecondRead: (() => void) | null = null
  let reads = 0
  const api: SheetsApi = {
    async tabs() { return [...tabs.entries()].map(([title, t]) => ({ title, sheetId: t.sheetId })) },
    async read(tab) {
      reads++
      if (reads === 2 && beforeSecondRead) beforeSecondRead()
      return (tabs.get(tab)?.rows ?? []).map((r) => [...r])
    },
    async append(tab, rows) { calls.push(`append:${tab}`); tabs.get(tab)!.rows.push(...rows.map((r) => [...r])) },
    async writeCells(tab, cells) {
      calls.push(`cells:${tab}`)
      const t = tabs.get(tab)!.rows
      for (const c of cells) { while (t.length < c.row) t.push([]); t[c.row - 1][c.col] = c.value }
    },
    async writeHeader(tab, headers) { calls.push(`header:${tab}`); const t = tabs.get(tab)!.rows; if (t.length) t[0] = [...headers]; else t.push([...headers]) },
    async deleteRows(sheetId, rows) {
      calls.push('delete')
      const t = [...tabs.values()].find((x) => x.sheetId === sheetId)!
      for (const r of [...rows].sort((a, b) => b - a)) t.rows.splice(r - 1, 1)
    },
    async ensureTab(tab, headers) {
      if (!tabs.has(tab)) tabs.set(tab, { sheetId: gid++, rows: headers.length ? [[...headers]] : [] })
      return { sheetId: tabs.get(tab)!.sheetId }
    },
  }
  return { api, tabs, calls, onSecondRead: (f: () => void) => { beforeSecondRead = f } }
}

const H = ['Name', 'Phone', 'Reg No', 'Date', 'Status']
const base = () => ({
  Leads: [
    H,
    ['Anu', '99478 40578', 'R-1', '01/09/2026', 'New'],
    ['Biju', '9846012345', 'R-2', '15/10/2026', 'New'],
    ['Anu', '+91 9947840578', 'R-3', '18/10/2026', 'New'],
  ],
})
const vars: Record<string, string> = { name: 'Chinnu', phone: '+919947840578', reg: 'R-2' }
const resolve = withDateTokens((t) => t.replace(/\{\{vars\.(\w+)\}\}/g, (_, k) => vars[k] ?? ''), { today: '2026-10-19', nowLabel: '2026-10-19 08:00' })
const opts = { nowWall: Date.UTC(2026, 9, 19, 8), nowLabel: '2026-10-19 08:00' }
const cfg = (c: SheetStepConfig): SheetStepConfig => ({ sheet_title: 'Leads', ...c })

describe('Google Sheet step — add', () => {
  it('adds a row placed by header name, with {{today}}', async () => {
    const s = fakeSheet(base())
    const r = await runSheetStep(s.api, cfg({ action: 'add', mapping: [{ column: 'status', value: 'Lead' }, { column: 'Name', value: '{{vars.name}}' }, { column: 'Date', value: '{{today}}' }] }), resolve, opts)
    expect(r.outcome).toBe('added')
    expect(s.tabs.get('Leads')!.rows.at(-1)).toEqual(['Chinnu', '', '', '2026-10-19', 'Lead'])
    expect(r.vars.sheet_name).toBe('Chinnu')
  })

  it('"add only if missing" does not add twice — same phone in another format', async () => {
    const s = fakeSheet(base())
    const r = await runSheetStep(s.api, cfg({ action: 'add', add_mode: 'if_missing', conditions: [{ column: 'Phone', op: 'equals', value: '{{vars.phone}}' }], mapping: [{ column: 'Name', value: 'X' }] }), resolve, opts)
    expect(r.outcome).toBe('exists')
    expect(r.vars.sheet_reg_no).toBe('R-3')
    expect(s.calls).toEqual([])
  })

  it('an empty new sheet gets its header row from the step', async () => {
    const s = fakeSheet({ Sheet1: [] })
    await runSheetStep(s.api, { action: 'add', mapping: [{ column: 'Name', value: '{{vars.name}}' }, { column: 'Phone', value: '{{vars.phone}}' }] }, resolve, opts)
    expect(s.tabs.get('Sheet1')!.rows).toEqual([['Name', 'Phone'], ['Chinnu', '+919947840578']])
  })

  it('says when a mapped column is gone, and still adds the rest', async () => {
    const s = fakeSheet(base())
    const r = await runSheetStep(s.api, cfg({ action: 'add', mapping: [{ column: 'Name', value: 'A' }, { column: 'District', value: 'B' }] }), resolve, opts)
    expect(r.warnings[0]).toMatch(/District/)
  })
})

describe('Google Sheet step — update', () => {
  it('updates the latest matching row by date; an unset variable leaves a cell alone', async () => {
    const s = fakeSheet(base())
    const r = await runSheetStep(s.api, cfg({
      action: 'update', which: 'latest', date_column: 'Date',
      conditions: [{ column: 'Phone', op: 'phone', value: '{{vars.phone}}' }],
      mapping: [{ column: 'Status', value: 'Paid' }, { column: 'Name', value: '{{vars.missing}}' }],
    }), resolve, opts)
    expect(r.outcome).toBe('updated')
    const rows = s.tabs.get('Leads')!.rows
    expect(rows[3]).toEqual(['Anu', '+91 9947840578', 'R-3', '18/10/2026', 'Paid'])
    expect(rows[1][4]).toBe('New')
    expect(r.vars.sheet_status).toBe('updated')
  })

  it('finds by a registration number; not found goes to the Not found branch', async () => {
    const s = fakeSheet(base())
    const ok = await runSheetStep(s.api, cfg({ action: 'update', conditions: [{ column: 'Reg No', op: 'equals', value: '{{vars.reg}}' }], mapping: [{ column: 'Status', value: 'Joined' }] }), resolve, opts)
    expect(ok.rows[0].row).toBe(3)
    const miss = await runSheetStep(s.api, cfg({ action: 'update', conditions: [{ column: 'Reg No', op: 'equals', value: 'R-99' }], mapping: [{ column: 'Status', value: 'Joined' }] }), resolve, opts)
    expect(miss.outcome).toBe('not_found')
  })

  it('follows a row that moved before writing (someone sorted the sheet)', async () => {
    const s = fakeSheet(base())
    s.onSecondRead(() => {
      const t = s.tabs.get('Leads')!.rows
      const [h, ...rest] = t
      s.tabs.get('Leads')!.rows = [h, ...rest.reverse()]
    })
    await runSheetStep(s.api, cfg({ action: 'update', conditions: [{ column: 'Reg No', op: 'equals', value: 'R-2' }], mapping: [{ column: 'Status', value: 'Moved-OK' }] }), resolve, opts)
    const rows = s.tabs.get('Leads')!.rows
    expect(rows.find((r) => r[2] === 'R-2')![4]).toBe('Moved-OK')
    expect(rows.filter((r) => r[4] === 'Moved-OK')).toHaveLength(1)
  })

  it('a test (dry run) writes nothing', async () => {
    const s = fakeSheet(base())
    const r = await runSheetStep(s.api, cfg({ action: 'update', conditions: [{ column: 'Reg No', op: 'equals', value: 'R-1' }], mapping: [{ column: 'Status', value: 'X' }] }), resolve, { ...opts, dryRun: true })
    expect(r.rows[0].after?.Status).toBe('X')
    expect(s.calls).toEqual([])
  })
})

describe('Google Sheet step — delete', () => {
  it('archives to a "Deleted" tab first, with when and from where, then removes', async () => {
    const s = fakeSheet(base())
    const r = await runSheetStep(s.api, cfg({ action: 'delete', which: 'all', conditions: [{ column: 'Phone', op: 'phone', value: '{{vars.phone}}' }] }), resolve, opts)
    expect(r.outcome).toBe('deleted')
    expect(s.tabs.get('Leads')!.rows.map((x) => x[2])).toEqual(['Reg No', 'R-2'])
    expect(s.tabs.get('Deleted')!.rows).toEqual([
      [...H, 'Deleted at', 'From tab'],
      ['Anu', '+91 9947840578', 'R-3', '18/10/2026', 'New', '2026-10-19 08:00', 'Leads'],
      ['Anu', '99478 40578', 'R-1', '01/09/2026', 'New', '2026-10-19 08:00', 'Leads'],
    ])
    expect(s.calls.indexOf('append:Deleted')).toBeLessThan(s.calls.indexOf('delete'))
  })

  it('only rows older than N days, by the date column', async () => {
    const s = fakeSheet(base())
    await runSheetStep(s.api, cfg({ action: 'delete', which: 'all', delete_mode: 'delete', date_column: 'Date', older_than_days: 30, conditions: [{ column: 'Name', op: 'not_empty', value: '' }] }), resolve, opts)
    expect(s.tabs.get('Leads')!.rows.map((x) => x[2])).toEqual(['Reg No', 'R-2', 'R-3'])
    expect(s.tabs.has('Deleted')).toBe(false)
  })

  it('never deletes a row that changed while it ran', async () => {
    const s = fakeSheet(base())
    s.onSecondRead(() => { s.tabs.get('Leads')!.rows[2][4] = 'Paid just now' })
    const r = await runSheetStep(s.api, cfg({ action: 'delete', conditions: [{ column: 'Reg No', op: 'equals', value: 'R-2' }] }), resolve, opts)
    expect(r.outcome).toBe('not_found')
    expect(s.tabs.get('Leads')!.rows).toHaveLength(4)
  })

  it('an unset variable deletes nothing — never the whole sheet', async () => {
    const s = fakeSheet(base())
    const r = await runSheetStep(s.api, cfg({ action: 'delete', which: 'all', conditions: [{ column: 'Reg No', op: 'equals', value: '{{vars.unset}}' }] }), resolve, opts)
    expect(r.outcome).toBe('not_found')
    expect(s.calls).toEqual([])
  })

  it('a tab that was renamed is said in words', async () => {
    const s = fakeSheet(base())
    await expect(runSheetStep(s.api, { sheet_title: 'Old tab', action: 'add', mapping: [{ column: 'Name', value: 'x' }] }, resolve, opts)).rejects.toThrow(/no tab called “Old tab”/)
  })
})

describe('business time', () => {
  it('today in the business zone, not the server clock', () => {
    const t = businessNow('Asia/Kolkata', new Date('2026-10-18T20:00:00Z'))
    expect(t.today).toBe('2026-10-19')
    expect(t.nowLabel).toBe('2026-10-19 01:30')
  })
})

/**
 * Bug (19 Oct 2026): the builder's Test for "Add row" and "Update" said
 * "Nothing to write: every mapped value came out empty" when the mapping
 * was made on another tab — none of its columns are in this one — or
 * when nothing was mapped. Delete (no mapping) worked, so it looked random.
 */
describe('Google Sheet step — says why there is nothing to write', () => {
  it('mapping from another tab: names the columns and says to map again', async () => {
    const s = fakeSheet(base())
    await expect(runSheetStep(s.api, cfg({ action: 'update', conditions: [{ column: 'Reg No', op: 'equals', value: 'R-1' }], mapping: [{ column: 'month', value: 'x' }, { column: 'Training Programe', value: 'y' }] }), resolve, opts))
      .rejects.toThrow(/None of the mapped columns.*month.*Map columns/)
    await expect(runSheetStep(s.api, cfg({ action: 'add', mapping: [{ column: 'month', value: 'x' }] }), resolve, opts))
      .rejects.toThrow(/None of the mapped columns/)
  })
  it('nothing mapped: says to map a column', async () => {
    const s = fakeSheet(base())
    await expect(runSheetStep(s.api, cfg({ action: 'update', conditions: [{ column: 'Reg No', op: 'equals', value: 'R-1' }], mapping: [] }), resolve, opts))
      .rejects.toThrow(/Map at least one column/)
  })
})

describe('Google Sheet step — template rows that only look empty', () => {
  // A registration template: rows 2–3 filled by people, rows 4–7 ready-made
  // with an unticked checkbox and a formula error in columns nobody maps.
  const template = () => ({
    Leads: [
      ['Sl No', 'Name', 'Phone', 'Paid', 'Code'],
      ['1', 'fgh', '', 'FALSE', '#N/A'],
      ['2', 'hy', '', 'FALSE', '#N/A'],
      ['', '', '', 'FALSE', '#N/A'],
      ['', '', '', 'FALSE', '#N/A'],
      ['', '', '', 'FALSE', '#N/A'],
      ['', '', '', 'FALSE', '#N/A'],
    ],
  })

  it('fills the first empty-looking row under the people, not row 8', async () => {
    const s = fakeSheet(template())
    const r = await runSheetStep(s.api, cfg({ action: 'add', mapping: [{ column: 'Name', value: '{{vars.name}}' }, { column: 'Phone', value: '{{vars.phone}}' }] }), resolve, opts)
    expect(r.rows[0].row).toBe(4)
    expect(r.vars.sheet_row).toBe('4')
    const rows = s.tabs.get('Leads')!.rows
    expect(rows[3]).toEqual(['', 'Chinnu', '+919947840578', 'FALSE', '#N/A'])
    expect(rows).toHaveLength(7)
    expect(s.calls).toEqual(['cells:Leads'])
  })

  it('a row a person started (only an unmapped column typed) is never written into', async () => {
    const t = template()
    t.Leads[4] = ['', '', '', 'TRUE', '#N/A']
    const s = fakeSheet(t)
    const r = await runSheetStep(s.api, cfg({ action: 'add', mapping: [{ column: 'Name', value: 'X' }] }), resolve, opts)
    expect(r.rows[0].row).toBe(6)
    expect(s.tabs.get('Leads')!.rows[4][1]).toBe('')
  })

  it('no ready-made rows left: added below, as before', async () => {
    const t = template()
    t.Leads = t.Leads.slice(0, 3)
    const s = fakeSheet(t)
    const r = await runSheetStep(s.api, cfg({ action: 'add', mapping: [{ column: 'Name', value: 'X' }] }), resolve, opts)
    expect(r.rows[0].row).toBe(4)
    expect(s.calls).toEqual(['append:Leads'])
  })
})
