/**
 * A report as an Excel workbook: a Summary sheet a manager can read and a
 * Data sheet they can work with.
 *
 * Only aggregates go in — counts, totals, rates — never a customer's name,
 * number or message, because a report never holds them in the first place.
 *
 * Text that came from people (lead sources, lost reasons, Data Store
 * options) is neutralised before it is written: a value beginning with
 * = + - @, tab or carriage return gets a leading apostrophe, so no
 * spreadsheet program — or a CSV someone saves from this file later —
 * reads it as a formula (OWASP "CSV Injection", CWE-1236).
 */

import ExcelJS from 'exceljs'
import type { ReportResult } from './engine'
import { formatDuration } from './insights'
import { shortDay } from './period'

export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

function lastDay(toExclusive: string): string {
  return new Date(Date.parse(`${toExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } }

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true }
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle' }
}

export async function reportWorkbook(
  r: ReportResult,
  insights: string[],
  meta: { accountName: string; generatedAt: string; timezone: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'WhatsApp CRM'
  wb.created = new Date()

  const valueFormat = r.unit === 'INR' ? '"₹"#,##0' : r.unit === 'min' ? '#,##0.0' : '#,##0'

  // ── Summary ──
  const s = wb.addWorksheet('Summary')
  s.columns = [{ width: 24 }, { width: 70 }]
  const title = s.addRow([safeText(r.title)])
  title.font = { bold: true, size: 14 }
  s.mergeCells(`A${title.number}:B${title.number}`)
  s.addRow([])
  s.addRow(['Business', safeText(meta.accountName)])
  s.addRow(['Period', `${shortDay(r.period.from)} – ${shortDay(lastDay(r.period.toExclusive))}`])
  s.addRow(['Generated', `${meta.generatedAt} (${meta.timezone})`])

  if (r.shape === 'count' || r.shape === 'sum') {
    const t = s.addRow(['Total', r.total])
    t.getCell(2).numFmt = valueFormat
    t.getCell(2).alignment = { horizontal: 'left' }
    const p = s.addRow(['Period before', r.previousTotal])
    p.getCell(2).numFmt = valueFormat
    p.getCell(2).alignment = { horizontal: 'left' }
  } else if (r.funnel) {
    s.addRow(['Started', r.funnel.all.started])
    s.addRow([`Reached "${safeText(r.funnel.toLabel)}"`, r.funnel.all.converted])
    const rate = s.addRow(['Rate', r.funnel.all.rate])
    rate.getCell(2).numFmt = '0%'
    rate.getCell(2).alignment = { horizontal: 'left' }
    s.addRow(['Typical time (median)', formatDuration(r.funnel.all.medianSeconds)])
  } else if (r.again) {
    s.addRow(['Customers', r.again.customers])
    s.addRow(['Came back more than once', r.again.returning])
  }

  if (insights.length) {
    s.addRow([])
    const h = s.addRow(['What stands out'])
    h.font = { bold: true }
    for (const line of insights) {
      const row = s.addRow(['', safeText(line)])
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    }
  }
  s.addRow([])
  const note = s.addRow(['', 'Totals and rates only — no customer names, numbers or messages are included.'])
  note.getCell(2).font = { italic: true, color: { argb: 'FF64748B' } }

  // ── Data ──
  const d = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] })
  const by = r.byLabel ?? 'All'

  if (r.series) {
    d.columns = [
      { header: r.bucket === 'day' ? 'Day' : r.bucket === 'week' ? 'Week starting' : 'Month', key: 't', width: 18 },
      { header: 'Value', key: 'v', width: 16, style: { numFmt: valueFormat } },
    ]
    for (const p of r.series) d.addRow({ t: p.t, v: p.value })
  } else if (r.groups) {
    d.columns = [
      { header: by, key: 'g', width: 32 },
      { header: 'This period', key: 'v', width: 16, style: { numFmt: valueFormat } },
      { header: 'Period before', key: 'p', width: 16, style: { numFmt: valueFormat } },
      { header: 'Change', key: 'c', width: 12, style: { numFmt: '0%' } },
    ]
    for (const g of r.groups) {
      d.addRow({ g: safeText(g.label), v: g.value, p: g.previous, c: g.previous ? (g.value - g.previous) / g.previous : null })
    }
    if (r.other) d.addRow({ g: 'Everything else', v: r.other })
    const total = d.addRow({ g: 'Total', v: r.total, p: r.previousTotal, c: r.previousTotal ? (r.total - r.previousTotal) / r.previousTotal : null })
    total.font = { bold: true }
  } else if (r.funnel) {
    d.columns = [
      { header: by, key: 'g', width: 32 },
      { header: 'Started', key: 's', width: 12 },
      { header: `Reached "${safeText(r.funnel.toLabel)}"`, key: 'c', width: 22 },
      { header: 'Rate', key: 'r', width: 10, style: { numFmt: '0%' } },
      { header: 'Typical time (median)', key: 'm', width: 22 },
    ]
    const rows = r.funnel.groups.length ? r.funnel.groups : []
    for (const g of rows) {
      d.addRow({ g: safeText(g.label), s: g.started, c: g.converted, r: g.rate, m: formatDuration(g.medianSeconds) })
    }
    const all = d.addRow({ g: 'All', s: r.funnel.all.started, c: r.funnel.all.converted, r: r.funnel.all.rate, m: formatDuration(r.funnel.all.medianSeconds) })
    all.font = { bold: true }
  } else if (r.again) {
    d.columns = [
      { header: 'Times', key: 't', width: 12 },
      { header: 'Customers', key: 'c', width: 14 },
    ]
    for (const x of r.again.distribution) d.addRow({ t: x.times, c: x.customers })
  }
  styleHeader(d.getRow(1))
  if (d.columnCount > 0) d.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: d.columnCount } }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

/** A filename safe on every system: letters, digits, spaces and dashes. */
export function exportFilename(title: string, from: string): string {
  const base = title.split(' — ')[0].replace(/[^\p{L}\p{N} -]+/gu, '').trim().slice(0, 60) || 'Report'
  return `${base} ${from}.xlsx`
}
