/**
 * Any ReportDoc as an Excel workbook, for people who want to work on the
 * numbers (docs/plans/reports-sections-plan.md).
 *
 *   - "Summary": business, title, period, headline, every figure card (label,
 *     value, before, change), findings, text and the report's notes.
 *   - One sheet per table block, and one per chart block (labels as rows,
 *     each series a column, previous-period columns beside them).
 *
 * Numbers stay numbers (TableCell.value when given); money gets a currency
 * number format. Every text cell goes through safeText, so "=HYPERLINK(…)"
 * stays text. Sheet names are unique, at most 31 characters, without the
 * characters Excel refuses. Headers are frozen; column widths follow content.
 */
import ExcelJS from 'exceljs'
import { safeText } from '@/lib/files/spreadsheet-safe'
import { zonedStamp } from '../excel'
import { t, type Key } from '../i18n'
import { changeLabel, judgeChange } from './change'
import { changeWords } from './change-words'
import type { ChartBlock, Fmt, KpiItem, ReportDoc, TableBlock, TableCell, DocBusiness } from './types'

export interface DocXlsxInput {
  doc: ReportDoc
  business: DocBusiness
  language: string
  generatedAt: Date
}

const CRM_NAME = 'Lead Magnet CRM'
/** Rows in one sheet, so a huge report cannot exhaust the server. */
const MAX_SHEET_ROWS = 20_000
const MAX_CELL_CHARS = 2000
const INT = '#,##0'

/** Cleaned, capped and made safe from formulas. */
const text = (s: unknown, max = MAX_CELL_CHARS): string =>
  safeText((typeof s === 'string' ? s : s == null ? '' : String(s)).slice(0, max * 2).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, max))

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The currency's own symbol, quoted for a number format; the code when unknown. */
function currencySymbol(code: string): string {
  const c = String(code ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  if (!c) return ''
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((x) => x.type === 'currency')
    return (part?.value ?? c).replace(/["\\]/g, '')
  } catch {
    return c
  }
}

/** Excel number format for a Fmt; percent values are already 0–100. */
export function numFmtFor(fmt: Fmt | undefined): string | undefined {
  switch (fmt?.kind) {
    case 'money': {
      const sym = currencySymbol(fmt.currency)
      return sym ? `"${sym}"#,##0.00` : '#,##0.00'
    }
    case 'percent': {
      const digits = Math.max(0, Math.min(4, fmt.digits ?? 1))
      return `${digits ? `0.${'0'.repeat(digits)}` : '0'}"%"`
    }
    case 'minutes': return '#,##0" min"'
    case 'count': return INT
    default: return undefined
  }
}

/**
 * A sheet name Excel accepts: none of []:*?/\, no apostrophe at either end,
 * at most 31 characters, not "History", and unique (case-insensitive).
 */
export function sheetNamer(): (raw: string) => string {
  const used = new Set<string>()
  return (raw: string) => {
    let base = String(raw ?? '').replace(/[\u0000-\u001f\u007f[\]:*?/\\]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim()
    if (!base || base.toLowerCase() === 'history') base = base ? `${base} sheet` : 'Sheet'
    base = Array.from(base).slice(0, 31).join('').trim()
    let name = base
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`
      name = `${Array.from(base).slice(0, 31 - suffix.length).join('').trim()}${suffix}`
    }
    used.add(name.toLowerCase())
    return name
  }
}

function widen(ws: ExcelJS.Worksheet, min = 10, max = 50) {
  ws.columns.forEach((col) => {
    let w = min
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value
      const len = v == null ? 0 : typeof v === 'number' ? String(Math.round(v * 100) / 100).length + 4 : String(v).length
      w = Math.max(w, Math.min(max, len + 2))
    })
    col.width = w
  })
}

export async function docToXlsx(input: DocXlsxInput): Promise<Buffer> {
  const { doc: report, business, language, generatedAt } = input
  const tr = (key: Key, params?: Record<string, string | number>) => t(language, key, params)
  const wb = new ExcelJS.Workbook()
  wb.creator = CRM_NAME
  wb.created = generatedAt
  const nameOf = sheetNamer()
  const p = report.period
  const tz = text(p?.timeZone, 60)
  const span = (a: unknown, b: unknown) => (text(a, 20) === text(b, 20) ? text(a, 20) : `${text(a, 20)} – ${text(b, 20)}`)
  const blocks = Array.isArray(report.blocks) ? report.blocks : []

  // ── Summary ────────────────────────────────────────────────────────
  const summary = wb.addWorksheet(nameOf('Summary'))
  summary.columns = [{ width: 36 }, { width: 22 }, { width: 18 }, { width: 14 }, { width: 60 }]
  summary.addRow([text(business.name, 200) || CRM_NAME]).font = { bold: true, size: 14 }
  for (const l of (Array.isArray(business.lines) ? business.lines : []).slice(0, 4)) summary.addRow([text(l, 200)])
  if (business.taxId) summary.addRow([text(tr('taxId', { id: text(business.taxId, 40) }), 120)])
  summary.addRow([text(tr('dReport')), text(report.title, 200)])
  summary.addRow([text(tr('period')), `${span(p?.firstDay, p?.lastDay)}${p?.partial ? ` (${tr('dSoFar')})` : ''}`, null, null, tz])
  if (p?.previous) summary.addRow(['', text(tr('dCompared', { range: span(p.previous.firstDay, p.previous.lastDay) }), 200)])
  summary.addRow(['', text(tr('generatedOn', { date: `${zonedStamp(generatedAt, safeZone(tz))} ${tz}` }), 200)])
  if (report.headline) {
    summary.addRow([])
    const r = summary.addRow([text(report.headline, 600)])
    r.font = { bold: true }
  }

  const kpiItems: Array<{ section?: string; item: KpiItem }> = []
  for (const b of blocks) if (b?.kind === 'kpis') for (const item of (Array.isArray(b.items) ? b.items : []).slice(0, 200)) kpiItems.push({ section: b.title, item })
  if (kpiItems.length) {
    summary.addRow([])
    summary.addRow([text(tr('dFigure')), text(tr('dValue')), text(tr('dBefore')), text(tr('dChange'))]).font = { bold: true }
    let lastSection: string | undefined
    for (const { section, item } of kpiItems) {
      if (section && section !== lastSection) summary.addRow([text(section, 200)]).font = { bold: true, italic: true }
      lastSection = section
      const c = item.compare
      const numeric = c && c.fmt.kind !== 'text' && finite(c.now)
      const before = c && finite(c.before) ? c.before : null
      // The shared rule (change.ts). A percent stays a number Excel can sort;
      // "too few" and "N× before" are words.
      const chg = numeric ? judgeChange(c) : null
      const f = c ? numFmtFor(c.fmt) : undefined
      let change: number | string | null = null
      let changeFmt: string | undefined
      if (chg?.kind === 'pct' || chg?.kind === 'same') { change = chg.value; changeFmt = '+0%;-0%;0%' }
      else if (chg?.kind === 'pts') { change = chg.value; changeFmt = '+0.0" pts";-0.0" pts";0" pts"' }
      else if (chg?.kind === 'abs') { change = chg.value; changeFmt = f }
      else if (chg && chg.kind !== 'none') change = text(changeLabel(chg, String, changeWords(language)) ?? '', 60)
      const row = summary.addRow([text(item.label, 200), numeric ? c.now : text(item.value, 100), before, change])
      if (f && numeric) row.getCell(2).numFmt = f
      if (f && before != null) row.getCell(3).numFmt = f
      if (changeFmt && typeof change === 'number') row.getCell(4).numFmt = changeFmt
      if (item.sub) row.getCell(5).value = text(item.sub, 200)
    }
  }

  for (const b of blocks) {
    if (b?.kind === 'findings' && Array.isArray(b.items) && b.items.length) {
      summary.addRow([])
      summary.addRow([text(b.title || tr('pFindings'), 200)]).font = { bold: true }
      const sev: Record<string, Key> = { high: 'dSevHigh', medium: 'dSevMedium', low: 'dSevLow', good: 'dSevGood' }
      for (const f of b.items.slice(0, 100)) {
        summary.addRow([text(f.title, 300), text(tr(sev[f.severity] ?? 'dSevLow')), f.byAi ? text(tr('dByAi')) : null, null, text(`${f.evidence ?? ''}${f.suggestion ? ` ${tr('dSuggestion', { text: f.suggestion })}` : ''}`, 1500)])
      }
    } else if (b?.kind === 'text' && Array.isArray(b.lines) && b.lines.length) {
      summary.addRow([])
      if (b.title) summary.addRow([text(b.title, 200)]).font = { bold: true }
      for (const l of b.lines.slice(0, 100)) summary.addRow([text(l, 1500)])
    }
  }

  const notes = (Array.isArray(report.notes) ? report.notes : []).slice(0, 50)
  if (notes.length) {
    summary.addRow([])
    summary.addRow([text(tr('dNotes'))]).font = { bold: true }
    for (const n of notes) summary.addRow([text(n, 1000)])
  }

  // ── a sheet per table ──────────────────────────────────────────────
  const tableSheet = (b: TableBlock) => {
    const ws = wb.addWorksheet(nameOf(text(b.title, 60) || 'Table'))
    const cols = (Array.isArray(b.columns) ? b.columns : []).slice(0, 200)
    ws.addRow(cols.map((c) => text(c.label, 200))).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    const cellValue = (cell: TableCell | undefined): string | number | null => {
      if (!cell) return null
      if (finite(cell.value)) return cell.value
      if (typeof cell.value === 'string') return text(cell.value)
      return text(cell.text)
    }
    const add = (cells: TableCell[], bold: boolean) => {
      const row = ws.addRow(cols.map((_, i) => cellValue(cells[i])))
      cols.forEach((c, i) => {
        const v = row.getCell(i + 1).value
        const f = typeof v === 'number' ? numFmtFor(c.fmt) ?? (Number.isInteger(v) ? INT : undefined) : undefined
        if (f) row.getCell(i + 1).numFmt = f
        if (c.align) row.getCell(i + 1).alignment = { horizontal: c.align }
      })
      if (bold) row.font = { bold: true }
    }
    const rows = Array.isArray(b.rows) ? b.rows : []
    if (!rows.length) ws.addRow([text(tr('nothing'))])
    for (const r of rows.slice(0, MAX_SHEET_ROWS)) add(Array.isArray(r) ? r : [], false)
    if (rows.length > MAX_SHEET_ROWS) ws.addRow([`+ ${rows.length - MAX_SHEET_ROWS}`])
    if (Array.isArray(b.total)) add(b.total, true)
    if (b.note) {
      ws.addRow([])
      ws.addRow([text(b.note, 1000)])
    }
    widen(ws)
  }

  // ── a sheet per chart: labels as rows, series as columns ──────────
  const chartSheet = (b: ChartBlock) => {
    const ws = wb.addWorksheet(nameOf(text(b.title, 60) || 'Chart'))
    const series = (Array.isArray(b.series) ? b.series : []).slice(0, 50)
    const labels = (Array.isArray(b.labels) ? b.labels : []).slice(0, MAX_SHEET_ROWS)
    const cols: Array<{ head: string; values: unknown[]; fmt?: Fmt }> = []
    for (const s of series) {
      cols.push({ head: text(s.name, 200), values: Array.isArray(s.values) ? s.values : [], fmt: s.fmt })
      if (Array.isArray(s.previous) && s.previous.length) cols.push({ head: text(tr('dPrevSeries', { name: String(s.name ?? '') }), 200), values: s.previous, fmt: s.fmt })
    }
    ws.addRow([text(tr('dItem')), ...cols.map((c) => c.head)]).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }]
    if (!labels.length) ws.addRow([text(tr('nothing'))])
    labels.forEach((l, i) => {
      const row = ws.addRow([text(l, 300), ...cols.map((c) => (finite(c.values[i]) ? c.values[i] as number : null))])
      cols.forEach((c, k) => {
        const v = row.getCell(k + 2).value
        const f = typeof v === 'number' ? numFmtFor(c.fmt) ?? (Number.isInteger(v) ? INT : undefined) : undefined
        if (f) row.getCell(k + 2).numFmt = f
      })
    })
    if (b.note) {
      ws.addRow([])
      ws.addRow([text(b.note, 1000)])
    }
    widen(ws)
  }

  for (const b of blocks) {
    if (b?.kind === 'table') tableSheet(b)
    else if (b?.kind === 'chart') chartSheet(b)
  }

  const out = await wb.xlsx.writeBuffer()
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}
