/**
 * The Spending report as an Excel workbook (the same figures as the screen and
 * the PDF, for people who want to work on them).
 *
 * - Text that came from people (names, teams, number labels, the business name)
 *   goes through safeText, so "=HYPERLINK(...)" stays text.
 * - Amounts stay numbers, with the currency in a column of its own. Money in
 *   different currencies is never added: a row that has two currencies is two
 *   rows, and the count it belongs to is written once.
 * - Dates are written as text in the business's zone, never the server's.
 * - A sheet holds at most MAX_SHEET_ROWS rows and says how many more there were.
 * - No customer names or numbers: there are none in the report.
 *
 * Pure: it lays out what assembleSpending already worked out.
 */
import ExcelJS from 'exceljs'
import { safeText } from '@/lib/files/spreadsheet-safe'
import { zonedStamp } from './excel'
import { channelLabel, type Money } from './spending-assemble'
import type { SpendingPdfReport } from './pdf/spending-pdf'

export interface SpendingWorkbookInput {
  report: SpendingPdfReport
  business: { name: string; taxId: string | null }
  generatedAt: Date
  timeZone: string
}

export const SPENDING_SHEETS = [
  'Summary', 'WhatsApp by category', 'WhatsApp by number', 'WhatsApp by person',
  'By team', 'By channel', 'By day', 'AI by feature', 'AI by person',
] as const

/** Rows in one sheet, so a huge period cannot exhaust the server. */
export const MAX_SHEET_ROWS = 5000

const INT = '#,##0'
const MONEY = '#,##0.00####'
const NONE = '—'

const CATEGORY: Record<string, string> = {
  marketing: 'Marketing', utility: 'Utility', authentication: 'Authentication',
  'authentication-international': 'Authentication (international)', service: 'Service',
  referral_conversion: 'Free entry point',
}

type Cell = string | number | null
const text = (s: string | null | undefined): string => safeText(String(s ?? ''))

/** One row per currency of a Money map: the first carries `lead`, the others have it blank. */
function perCurrency(lead: Cell[], m: Money): Cell[][] {
  const entries = Object.entries(m)
  if (entries.length === 0) return [[...lead, null, NONE]]
  return entries.map(([currency, amount], i) => [...(i === 0 ? lead : lead.map(() => null)), amount, currency])
}

function sheet(
  wb: ExcelJS.Workbook,
  name: (typeof SPENDING_SHEETS)[number],
  headings: string[],
  body: Cell[][],
  formats: Record<number, string> = {},
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name)
  ws.addRow(headings).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  if (body.length === 0) {
    ws.addRow(['Nothing in this period.'])
  } else {
    for (const r of body.slice(0, MAX_SHEET_ROWS)) ws.addRow(r)
    if (body.length > MAX_SHEET_ROWS) ws.addRow([`and ${body.length - MAX_SHEET_ROWS} more rows are not shown`])
  }
  headings.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.max(14, Math.min(40, h.length + 6))
    if (formats[i]) ws.getColumn(i + 1).numFmt = formats[i]
  })
  return ws
}

export function buildSpendingWorkbook(input: SpendingWorkbookInput): ExcelJS.Workbook {
  const { report: r, business, generatedAt, timeZone } = input
  const biz = r.businessCurrency
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Lead Magnet CRM'
  wb.created = generatedAt

  // ── Summary: who, when, and the headline figures ──────────────────
  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 34 }, { width: 18 }, { width: 14 }, { width: 60 }]
  summary.addRow([text(business.name)]).font = { bold: true, size: 14 }
  if (business.taxId) summary.addRow(['Tax number', text(business.taxId)])
  summary.addRow(['Report', 'Spending'])
  summary.addRow(['Period', `${r.period.firstDay} to ${r.period.lastDay}`, null, `${r.period.timeZone}${r.period.partial ? ', so far' : ''}`])
  summary.addRow(['Generated', zonedStamp(generatedAt, timeZone), null, timeZone])
  summary.addRow([])
  summary.addRow(['Figure', 'Amount', 'Currency', 'Note']).font = { bold: true }
  const money = (label: string, amount: number | null, currency: string | null, note = '') => {
    const row = summary.addRow([label, amount, currency ?? (amount === null ? NONE : null), note])
    if (typeof amount === 'number') row.getCell(2).numFmt = MONEY
  }
  money('Total spend', r.totals.combined, r.totals.combinedCurrency, r.totals.excluded.length ? 'Some amounts are left out: see below' : 'WhatsApp, AI and Meta Ads')
  for (const [currency, amount] of Object.entries(r.whatsapp.total)) money('WhatsApp messages', amount, currency, `${r.whatsapp.delivered} delivered, ${r.whatsapp.free} free`)
  if (Object.keys(r.whatsapp.total).length === 0) money('WhatsApp messages', null, null, `${r.whatsapp.delivered} delivered`)
  if (r.ai.inBusinessCurrency) money('AI (estimated)', r.ai.inBusinessCurrency.amount, r.ai.inBusinessCurrency.currency, `${r.ai.calls} calls${r.ai.inBusinessCurrency.currency === 'INR' ? ` at ${r.ai.inBusinessCurrency.rate} per US dollar` : ''}`)
  money('AI (estimated), US dollars', r.ai.costUsd, 'USD', `${r.ai.calls} calls`)
  money('Meta Ads', r.ads.connected ? r.ads.spend : null, r.ads.currency, r.ads.error ?? (r.ads.connected ? `${r.ads.clicks} clicks` : 'Not connected'))
  money('Cost per lead', r.outcomes.costPerLead, r.outcomes.costPerLead === null ? null : biz, `${r.outcomes.leads} leads in this period`)
  money('Cost per won deal', r.outcomes.costPerWon, r.outcomes.costPerWon === null ? null : biz, `${r.outcomes.wonDeals} deals won`)
  const notes = [...r.warnings, ...r.totals.excluded]
  if (notes.length) {
    summary.addRow([])
    summary.addRow(['Notes']).font = { bold: true }
    for (const n of notes) summary.addRow([text(n)])
  }
  summary.addRow([])
  summary.addRow(['AI cost is an estimate from the provider\'s own token counts. Amounts in different currencies are never added together.'])

  // ── WhatsApp ───────────────────────────────────────────────────────
  sheet(wb, 'WhatsApp by category', ['Category', 'Type', 'Messages', 'Without a price', 'Amount', 'Currency'],
    r.whatsapp.byCategory.flatMap((c) =>
      perCurrency([text(CATEGORY[c.category ?? ''] ?? c.category ?? NONE), text(c.type ?? NONE), c.count, c.unpriced], c.amount)
        // perCurrency puts amount and currency last: keep the heading order.
    ),
    { 2: INT, 3: INT, 4: MONEY })

  sheet(wb, 'WhatsApp by number', ['Number', 'Messages', 'Amount', 'Currency'],
    r.whatsapp.byNumber.flatMap((n) => perCurrency([text(n.label), n.count], n.amount)),
    { 1: INT, 2: MONEY })

  sheet(wb, 'WhatsApp by person', ['Sent by', 'Kind', 'Messages', 'Amount', 'Currency'],
    r.whatsapp.byPerson.flatMap((p) => perCurrency([text(p.name), p.kind, p.count], p.amount)),
    { 2: INT, 3: MONEY })

  // ── Teams and channels ─────────────────────────────────────────────
  sheet(wb, 'By team', ['Team', 'People', 'WhatsApp amount', 'Currency', 'AI (US dollars)'],
    r.byTeam.flatMap((t) => {
      const entries = Object.entries(t.whatsapp)
      if (entries.length === 0) return [[text(t.team), t.people, null, NONE, t.aiUsd]]
      return entries.map(([currency, amount], i) => [i === 0 ? text(t.team) : null, i === 0 ? t.people : null, amount, currency, i === 0 ? t.aiUsd : null])
    }),
    { 1: INT, 2: MONEY, 4: MONEY })

  sheet(wb, 'By channel', ['Channel', 'WhatsApp amount', 'Currency', 'AI (US dollars)'],
    r.byChannel.flatMap((c) => {
      const entries = Object.entries(c.messages)
      if (entries.length === 0) return [[text(channelLabel(c.channel)), null, NONE, c.aiUsd]]
      return entries.map(([currency, amount], i) => [i === 0 ? text(channelLabel(c.channel)) : null, amount, currency, i === 0 ? c.aiUsd : null])
    }),
    { 1: MONEY, 3: MONEY })

  sheet(wb, 'By day', ['Day', 'WhatsApp amount', 'Currency', 'AI (US dollars)'],
    r.byDay.flatMap((d) => {
      const entries = Object.entries(d.whatsapp)
      if (entries.length === 0) return [[d.day, null, NONE, d.aiUsd]]
      return entries.map(([currency, amount], i) => [i === 0 ? d.day : null, amount, currency, i === 0 ? d.aiUsd : null])
    }),
    { 1: MONEY, 3: MONEY })

  // ── AI ─────────────────────────────────────────────────────────────
  sheet(wb, 'AI by feature', ['Feature', 'Calls', 'Cost (US dollars)'],
    r.ai.byFeature.map((f) => [text(f.feature.replace(/_/g, ' ')), f.calls, f.costUsd]),
    { 1: INT, 2: MONEY })

  sheet(wb, 'AI by person', ['Person', 'Calls', 'Cost (US dollars)'],
    r.ai.byPerson.map((p) => [text(p.name), p.calls, p.costUsd]),
    { 1: INT, 2: MONEY })

  return wb
}
