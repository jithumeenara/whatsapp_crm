import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildReportWorkbook, howLong, SHEETS } from './excel'
import type { ReportSummary } from './summary'

const leak = (count: number, rows: ReportSummary['leaks']['neverContacted']['rows'] = []) => ({ count, rows })

function summary(over: Partial<ReportSummary> = {}): ReportSummary {
  return {
    generatedAt: '2026-11-07T09:00:00.000Z',
    scope: 'team',
    cohort: { total: 20, won: 5, lost: 3, closedNoOutcome: 2, open: 10 },
    previousCohort: { total: 10, won: 2, lost: 1, closedNoOutcome: 0, open: 7 },
    excluded: 4,
    wonInPeriod: 6,
    lostInPeriod: 3,
    previousWonInPeriod: 3,
    calls: { total: 40, connected: 25, previousTotal: 0, countedSince: '2026-01-01T00:00:00.000Z' },
    revenue: [{ currency: 'INR', amount: 1234567, deals: 6, withAmount: 5 }],
    previousRevenue: [{ currency: 'INR', amount: 1000000, deals: 3, withAmount: 3 }],
    lostAmount: [],
    pipeline: [{ currency: 'INR', amount: 500000, deals: 4, withAmount: 4 }],
    pipelineByStage: [{ pipeline: 'Sales', stage: 'Quoted', deals: 4, amount: 500000, currency: 'INR' }],
    wonWithoutDate: 2,
    bySource: [{ source: '=HYPERLINK("http://evil","x")', total: 20, won: 5, lost: 3, closedNoOutcome: 2, open: 10 }],
    byCategory: [{ category: 'Courses', deals: 6, amount: 1234567, currency: 'INR' }],
    lostReasons: [{ reason: 'Too costly', count: 3 }],
    leaks: {
      neverContacted: leak(10, [{ id: 'l1', title: '+cmd|calc', since: '2026-11-04T09:00:00.000Z', owner: 'Asha' }]),
      overdueFollowUps: leak(0),
      unassigned: leak(1, [{ id: 'l2', title: 'Walk-in', since: '2026-11-07T06:00:00.000Z', owner: null }]),
      waitingChats: leak(0),
    },
    leakHours: 24,
    funnel: [],
    agents: [{ userId: 'u1', name: '@Asha', leads: 8, calls: 30, connected: 20, won: 4, lost: 1, overdueFollowUps: 2, daysWorked: 4, medianFirstReplyMinutes: 12 }],
    ...over,
  }
}

const build = (s = summary()) =>
  buildReportWorkbook({
    summary: s,
    period: { kind: 'week', firstDay: '2026-11-02', lastDay: '2026-11-07', partial: true },
    headline: '20 leads came in this week, 6 won.',
    actions: [{ key: 'never', count: 10, text: 'Call the 10 leads nobody has contacted in over 24 hours.' }],
    timeZone: 'Asia/Kolkata',
  })

/** Every value in a sheet, row by row. */
function values(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = []
  ws.eachRow((row) => out.push((row.values as unknown[]).slice(1)))
  return out
}
const find = (ws: ExcelJS.Worksheet, first: string) => values(ws).find((r) => r[0] === first)

describe('buildReportWorkbook', () => {
  it('has the eight sheets, in order', () => {
    expect(build().worksheets.map((w) => w.name)).toEqual([...SHEETS])
  })

  it('Summary: period with zone and "so far", KPIs with previous and change, notes', () => {
    const ws = build().getWorksheet('Summary')!
    expect(find(ws, 'Last day')).toEqual(['Last day', '2026-11-07 (so far)'])
    expect(find(ws, 'Time zone')).toEqual(['Time zone', 'Asia/Kolkata'])
    expect(find(ws, 'Made at')).toEqual(['Made at', '2026-11-07 14:30'])
    expect(find(ws, 'Leads that came in')).toEqual(['Leads that came in', 20, 10, 1])
    expect(find(ws, 'Revenue (INR)')).toEqual(['Revenue (INR)', 1234567, 1000000, 0.23])
    // Nothing to compare with: a dash, not a fake percentage.
    expect(find(ws, 'Calls made')).toEqual(['Calls made', 40, 0, '—'])
    const text = values(ws).map((r) => r[0]).join('\n')
    expect(text).toContain('2 won deals were closed before win dates')
    expect(text).toContain('4 hidden or unconfirmed')
    expect(text).toContain('1 won deals have no amount')
  })

  it('a finished period has no "so far"', () => {
    const wb = buildReportWorkbook({
      summary: summary(), period: { kind: 'custom', firstDay: '2026-10-01', lastDay: '2026-10-31', partial: false },
      headline: 'x', actions: [], timeZone: 'Asia/Kolkata',
    })
    expect(find(wb.getWorksheet('Summary')!, 'Last day')).toEqual(['Last day', '2026-10-31'])
  })

  it('Outcomes add up, with shares', () => {
    const ws = build().getWorksheet('Outcomes')!
    expect(find(ws, 'Won')).toEqual(['Won', 5, 0.25])
    expect(find(ws, 'Still open')).toEqual(['Still open', 10, 0.5])
  })

  it('a label starting with "=" is written as text, not a formula', () => {
    const ws = build().getWorksheet('Sources')!
    const cell = ws.getRow(2).getCell(1)
    expect(cell.value).toBe('\'=HYPERLINK("http://evil","x")')
    // A formula would be an object ({ formula }), never a plain string.
    expect(typeof cell.value).toBe('string')
    expect(build().getWorksheet('Team')!.getRow(2).getCell(1).value).toBe("'@Asha")
    expect(build().getWorksheet('Needs doing')!.getRow(2).getCell(2).value).toBe("'+cmd|calc")
  })

  it('money stays a number with a thousands format, beside its currency', () => {
    const ws = build().getWorksheet('Pipeline')!
    expect(ws.getRow(1).getCell(4).value).toBe('Amount (INR)')
    const amount = ws.getRow(2).getCell(4)
    expect(amount.value).toBe(500000)
    expect(typeof amount.value).toBe('number')
    expect(amount.numFmt).toBe('#,##0')
    expect(ws.getRow(2).getCell(5).value).toBe('INR')
    const cat = build().getWorksheet('Revenue by category')!.getRow(2)
    expect(cat.values).toEqual([undefined, 'Courses', 6, 1234567, 'INR'])
  })

  it('mixed currencies are never added, and the header says so', () => {
    const wb = build(summary({ pipelineByStage: [
      { pipeline: 'Sales', stage: 'Quoted', deals: 1, amount: 100, currency: 'INR' },
      { pipeline: 'Sales', stage: 'Quoted', deals: 1, amount: 50, currency: 'USD' },
    ] }))
    const ws = wb.getWorksheet('Pipeline')!
    expect(ws.getRow(1).getCell(4).value).toBe('Amount')
    expect(ws.rowCount).toBe(3)
  })

  it('a Funnel sheet after Outcomes only when stages are set up', () => {
    const wb = build(summary({ funnel: [
      { key: 'new', label: 'Enquiry', outcome: 'open', count: 20 },
      { key: 'paid', label: '=Paid', outcome: 'won', count: 5 },
    ] }))
    expect(wb.worksheets.map((w) => w.name).slice(0, 4)).toEqual(['Summary', 'Outcomes', 'Funnel', 'Sources'])
    const rows = values(wb.getWorksheet('Funnel')!)
    expect(rows[0]).toEqual(['Stage', 'Outcome', 'Leads', "% of the period's leads"])
    expect(rows[1]).toEqual(['Enquiry', 'Open', 20, 1])
    expect(rows[2]).toEqual(["'=Paid", 'Won', 5, 0.25])
    expect(build().getWorksheet('Funnel')).toBeUndefined()
  })

  it('Lost reasons and Team rows', () => {
    expect(find(build().getWorksheet('Lost reasons')!, 'Too costly')).toEqual(['Too costly', 3, 1])
    const team = build().getWorksheet('Team')!.getRow(2).values as unknown[]
    // calls per day = 30 / 4, median first reply in minutes
    expect(team.slice(1)).toEqual(["'@Asha", 8, 30, 7.5, 20, 20 / 30, 4, 1, 2, 4, 12])
  })

  it('Needs doing: title, how long, owner, and a note when more exist', () => {
    const rows = values(build().getWorksheet('Needs doing')!)
    expect(rows[0]).toEqual(['List', 'Title', 'How long', 'Since', 'Owner'])
    expect(rows[1]).toEqual(['Never contacted', "'+cmd|calc", '3 days', '2026-11-04 14:30', 'Asha'])
    expect(rows[2]).toEqual(['Never contacted', 'and 9 more not listed', '', '', ''])
    expect(rows[3]).toEqual(['No owner', 'Walk-in', '3 hours', '2026-11-07 11:30', 'Nobody'])
  })

  it('an agent\'s own report has no "No owner" list', () => {
    const rows = values(build(summary({ scope: 'self' })).getWorksheet('Needs doing')!)
    expect(rows.some((r) => r[0] === 'No owner')).toBe(false)
  })

  it('empty data still gives every sheet, with a plain line', () => {
    const empty = summary({
      cohort: { total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0 }, bySource: [], lostReasons: [], pipelineByStage: [],
      byCategory: [], agents: [], revenue: [], previousRevenue: [], pipeline: [],
      leaks: { neverContacted: leak(0), overdueFollowUps: leak(0), unassigned: leak(0), waitingChats: leak(0) },
    })
    const wb = build(empty)
    expect(wb.worksheets).toHaveLength(8)
    expect(find(wb.getWorksheet('Outcomes')!, 'Won')).toEqual(['Won', 0, '—'])
    expect(values(wb.getWorksheet('Needs doing')!)[1]).toEqual(['Nothing open longer than 24 hours.'])
    expect(find(wb.getWorksheet('Summary')!, 'Revenue')).toEqual(['Revenue', 0, 0, '—'])
  })

  it('writes a real xlsx', async () => {
    const buf = await build().xlsx.writeBuffer()
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(buf)
    expect(back.worksheets.map((w) => w.name)).toEqual([...SHEETS])
    expect(back.getWorksheet('Pipeline')!.getRow(2).getCell(4).value).toBe(500000)
  })
})

describe('howLong', () => {
  const now = new Date('2026-11-07T12:00:00Z')
  it('minutes, hours, days', () => {
    expect(howLong(new Date('2026-11-07T11:59:00Z'), now)).toBe('1 minute')
    expect(howLong(new Date('2026-11-07T07:00:00Z'), now)).toBe('5 hours')
    expect(howLong(new Date('2026-11-04T12:00:00Z'), now)).toBe('3 days')
  })
})
