/**
 * The owner report as an Excel workbook (docs/plans/reports-plan.md
 * Phase 1 item 8). Pure: it lays out numbers buildSummary already worked
 * out and computes none of its own beyond a percentage or a per-day rate.
 *
 * - Text that came from people (names, sources, reasons, stage names,
 *   lead titles) goes through safeText, so "=HYPERLINK(...)" stays text.
 * - Numbers stay numbers, with a thousands-separator format; money sits
 *   beside the currency it is in, never added across currencies.
 * - Dates are written as text in the business's zone, never the server's.
 */

import ExcelJS from 'exceljs'
import { safeText } from '@/lib/files/spreadsheet-safe'
import { change, type Action } from './headline'
import type { Count, Leak, Money, ReportSummary } from './summary'
import type { ReportPeriod } from './period'

export type ExcelPeriod = Pick<ReportPeriod, 'kind' | 'firstDay' | 'lastDay' | 'partial'>

export interface ReportWorkbookInput {
  summary: ReportSummary
  period: ExcelPeriod
  headline: string
  actions: Action[]
  timeZone: string
}

/** Always present; "Funnel" goes after "Outcomes" when stages are set up. */
export const SHEETS = ['Summary', 'Outcomes', 'Sources', 'Lost reasons', 'Pipeline', 'Revenue by category', 'Team', 'Needs doing'] as const

const INT = '#,##0'
const DEC = '#,##0.0'
const PCT = '0%'
const NONE = '—'
const PERIOD_NAME: Record<ExcelPeriod['kind'], string> = { today: 'Today', week: 'This week', month: 'This month', custom: 'Chosen dates' }

/** "2026-11-07 14:30" in the zone. */
export function zonedStamp(at: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

/** "3 days", "5 hours", "20 minutes" between two instants. */
export function howLong(since: Date, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000))
  const unit = (n: number, one: string) => `${n.toLocaleString('en-IN')} ${one}${n === 1 ? '' : 's'}`
  if (min < 60) return unit(min, 'minute')
  if (min < 48 * 60) return unit(Math.floor(min / 60), 'hour')
  return unit(Math.floor(min / 1440), 'day')
}

const share = (part: number, total: number): number | string => (total > 0 ? part / total : NONE)
const changeCell = (now: number, before: number): number | string => {
  const c = change(now, before)
  return c == null ? NONE : c / 100
}

/** "Amount (INR)" when every row is in one currency, else "Amount". */
function amountHeader(currencies: string[]): string {
  const set = [...new Set(currencies)]
  return set.length === 1 ? `Amount (${set[0]})` : 'Amount'
}

interface Col { header: string; width: number; numFmt?: string }

/** A table sheet: bold, frozen header row, widths, a format per column. */
function tableSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Array<Array<string | number>>, empty: string) {
  const sheet = wb.addWorksheet(name)
  sheet.columns = cols.map((c) => ({ header: c.header, width: c.width }))
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (!rows.length) {
    sheet.addRow([empty])
    return sheet
  }
  for (const r of rows) {
    const row = sheet.addRow(r)
    cols.forEach((c, i) => {
      if (c.numFmt && typeof r[i] === 'number') row.getCell(i + 1).numFmt = c.numFmt
    })
  }
  return sheet
}

function moneyRows(label: string, now: Money[], before: Money[] | null): Array<Array<string | number>> {
  const currencies = [...new Set([...now.map((m) => m.currency), ...(before ?? []).map((m) => m.currency)])]
  if (!currencies.length) return [[label, 0, before ? 0 : NONE, NONE]]
  return currencies.map((cur) => {
    const a = now.find((m) => m.currency === cur)?.amount ?? 0
    if (!before) return [`${label} (${cur})`, a, NONE, NONE]
    const b = before.find((m) => m.currency === cur)?.amount ?? 0
    return [`${label} (${cur})`, a, b, changeCell(a, b)]
  })
}

function summarySheet(wb: ExcelJS.Workbook, input: ReportWorkbookInput) {
  const { summary: s, period: p, timeZone } = input
  const sheet = wb.addWorksheet('Summary')
  sheet.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 12 }]
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const title = sheet.addRow([s.scope === 'self' ? 'My report' : 'Owner report'])
  title.font = { bold: true, size: 14 }
  sheet.addRow([safeText(input.headline)])
  sheet.addRow([])
  sheet.addRow(['Period', PERIOD_NAME[p.kind]])
  sheet.addRow(['First day', p.firstDay])
  sheet.addRow(['Last day', p.partial ? `${p.lastDay} (so far)` : p.lastDay])
  sheet.addRow(['Time zone', timeZone])
  sheet.addRow(['Made at', zonedStamp(new Date(s.generatedAt), timeZone)])
  sheet.addRow([])

  const head = sheet.addRow(['Key numbers', 'This period', 'Previous period', 'Change'])
  head.font = { bold: true }
  const rows: Array<Array<string | number>> = [
    ['Leads that came in', s.cohort.total, s.previousCohort.total, changeCell(s.cohort.total, s.previousCohort.total)],
    ['Won in the period', s.wonInPeriod, s.previousWonInPeriod, changeCell(s.wonInPeriod, s.previousWonInPeriod)],
    ['Lost in the period', s.lostInPeriod, NONE, NONE],
    ["Still open (of this period's leads)", s.cohort.open, s.previousCohort.open, changeCell(s.cohort.open, s.previousCohort.open)],
    ...moneyRows('Revenue', s.revenue, s.previousRevenue),
    ...moneyRows('Pipeline, open deals now', s.pipeline, null),
    ['Calls made', s.calls.total, s.calls.previousTotal, changeCell(s.calls.total, s.calls.previousTotal)],
    ['Calls connected', s.calls.connected, NONE, NONE],
  ]
  for (const r of rows) {
    const row = sheet.addRow(r)
    ;[2, 3].forEach((i) => { if (typeof r[i - 1] === 'number') row.getCell(i).numFmt = INT })
    if (typeof r[3] === 'number') row.getCell(4).numFmt = PCT
  }

  if (input.actions.length) {
    sheet.addRow([])
    sheet.addRow(['To do first']).font = { bold: true }
    for (const a of input.actions) sheet.addRow([safeText(a.text)])
  }

  const notes: string[] = []
  if (s.calls.countedSince) {
    const since = zonedStamp(new Date(s.calls.countedSince), timeZone).slice(0, 10)
    if (since > p.firstDay) notes.push(`Calls are counted from ${since}, when call recording started.`)
  } else notes.push('No calls recorded yet.')
  if (s.wonWithoutDate) notes.push(`${s.wonWithoutDate.toLocaleString('en-IN')} won deals were closed before win dates were recorded and are not in any period's revenue.`)
  if (s.excluded) notes.push(`${s.excluded.toLocaleString('en-IN')} hidden or unconfirmed suggested leads are left out.`)
  const missing = s.revenue.reduce((n, m) => n + m.deals - m.withAmount, 0)
  if (missing) notes.push(`${missing.toLocaleString('en-IN')} won deals have no amount, so revenue is incomplete.`)
  if (s.revenue.length > 1) notes.push('Money in different currencies is listed separately, never added together.')
  if (notes.length) {
    sheet.addRow([])
    sheet.addRow(['About these numbers']).font = { bold: true }
    for (const n of notes) sheet.addRow([n])
  }
}

function outcomesSheet(wb: ExcelJS.Workbook, c: Count) {
  const rows: Array<Array<string | number>> = [
    ['Won', c.won, share(c.won, c.total)],
    ['Lost', c.lost, share(c.lost, c.total)],
    ['Closed, no outcome', c.closedNoOutcome, share(c.closedNoOutcome, c.total)],
    ['Still open', c.open, share(c.open, c.total)],
    ['Came in (total)', c.total, share(c.total, c.total)],
  ]
  tableSheet(wb, 'Outcomes', [
    { header: "What became of this period's leads", width: 36 },
    { header: 'Leads', width: 12, numFmt: INT },
    { header: 'Share', width: 10, numFmt: PCT },
  ], rows, '')
}

function leakRows(title: string, leak: Leak, now: Date, tz: string): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = leak.rows.map((r) => [
    title, safeText(r.title), howLong(new Date(r.since), now), zonedStamp(new Date(r.since), tz), r.owner ? safeText(r.owner) : 'Nobody',
  ])
  if (leak.count > leak.rows.length) rows.push([title, `and ${(leak.count - leak.rows.length).toLocaleString('en-IN')} more not listed`, '', '', ''])
  return rows
}

export function buildReportWorkbook(input: ReportWorkbookInput): ExcelJS.Workbook {
  const { summary: s, timeZone: tz } = input
  const wb = new ExcelJS.Workbook()
  wb.created = new Date(s.generatedAt)

  summarySheet(wb, input)
  outcomesSheet(wb, s.cohort)

  // The business's own stages; no sheet until they are set up.
  const funnel = s.funnel ?? []
  if (funnel.length) {
    const OUTCOME_WORD: Record<string, string> = { open: 'Open', won: 'Won', lost: 'Lost' }
    tableSheet(wb, 'Funnel', [
      { header: 'Stage', width: 30 }, { header: 'Outcome', width: 10 }, { header: 'Leads', width: 10, numFmt: INT },
      { header: "% of the period's leads", width: 22, numFmt: PCT },
    ], funnel.map((f) => [safeText(f.label), OUTCOME_WORD[f.outcome] ?? f.outcome, f.count, share(f.count, s.cohort.total)]), '')
  }

  tableSheet(wb, 'Sources', [
    { header: 'Source', width: 28 }, { header: 'Leads', width: 10, numFmt: INT }, { header: 'Won', width: 10, numFmt: INT },
    { header: 'Lost', width: 10, numFmt: INT }, { header: 'Closed, no outcome', width: 18, numFmt: INT }, { header: 'Still open', width: 12, numFmt: INT },
    { header: 'Won %', width: 10, numFmt: PCT },
  ], s.bySource.map((x) => [safeText(x.source), x.total, x.won, x.lost, x.closedNoOutcome, x.open, share(x.won, x.total)]), 'No leads came in this period.')

  const lostTotal = s.lostReasons.reduce((n, r) => n + r.count, 0)
  tableSheet(wb, 'Lost reasons', [
    { header: 'Reason', width: 40 }, { header: 'Leads', width: 10, numFmt: INT }, { header: 'Share', width: 10, numFmt: PCT },
  ], s.lostReasons.map((r) => [safeText(r.reason), r.count, share(r.count, lostTotal)]), 'No leads were lost this period.')

  tableSheet(wb, 'Pipeline', [
    { header: 'Pipeline', width: 24 }, { header: 'Stage', width: 24 }, { header: 'Open deals', width: 12, numFmt: INT },
    { header: amountHeader(s.pipelineByStage.map((x) => x.currency)), width: 16, numFmt: INT }, { header: 'Currency', width: 10 },
  ], s.pipelineByStage.map((x) => [safeText(x.pipeline), safeText(x.stage), x.deals, x.amount, safeText(x.currency)]), 'No open deals.')

  tableSheet(wb, 'Revenue by category', [
    { header: 'Category', width: 30 }, { header: 'Won deals', width: 12, numFmt: INT },
    { header: amountHeader(s.byCategory.map((x) => x.currency)), width: 16, numFmt: INT }, { header: 'Currency', width: 10 },
  ], s.byCategory.map((x) => [safeText(x.category), x.deals, x.amount, safeText(x.currency)]), 'No deals were won this period.')

  tableSheet(wb, 'Team', [
    { header: 'Name', width: 24 }, { header: 'Leads', width: 10, numFmt: INT }, { header: 'Calls', width: 10, numFmt: INT },
    { header: 'Calls per day', width: 14, numFmt: DEC }, { header: 'Connected', width: 12, numFmt: INT }, { header: 'Connected %', width: 13, numFmt: PCT },
    { header: 'Won', width: 8, numFmt: INT }, { header: 'Lost', width: 8, numFmt: INT }, { header: 'Late follow-ups', width: 15, numFmt: INT },
    { header: 'Days active', width: 12, numFmt: INT }, { header: 'Median first reply (minutes)', width: 26, numFmt: INT },
  ], s.agents.map((a) => [
    safeText(a.name), a.leads, a.calls, a.daysWorked > 0 ? a.calls / a.daysWorked : NONE, a.connected, share(a.connected, a.calls),
    a.won, a.lost, a.overdueFollowUps, a.daysWorked, a.medianFirstReplyMinutes ?? NONE,
  ]), 'No activity in this period.')

  const now = new Date(s.generatedAt)
  const l = s.leaks
  const doing = [
    ...leakRows('Never contacted', l.neverContacted, now, tz),
    ...leakRows('Customer waiting for a reply', l.waitingChats, now, tz),
    ...leakRows('Overdue follow-up', l.overdueFollowUps, now, tz),
    ...(s.scope === 'team' ? leakRows('No owner', l.unassigned, now, tz) : []),
  ]
  tableSheet(wb, 'Needs doing', [
    { header: 'List', width: 28 }, { header: 'Title', width: 36 }, { header: 'How long', width: 14 },
    { header: 'Since', width: 18 }, { header: 'Owner', width: 22 },
  ], doing, `Nothing open longer than ${s.leakHours} hours.`)

  return wb
}
