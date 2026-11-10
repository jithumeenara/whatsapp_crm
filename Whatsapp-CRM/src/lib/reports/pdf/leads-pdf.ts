/**
 * The Leads (owner) report as a PDF, in the business's report language.
 *
 * Same look and rules as the Spending PDF (spending-pdf.ts): the business's
 * name, address, tax number and logo on top; figures as cards; breakdowns as
 * tables whose heading repeats on every page; the CRM's name and "Page X of
 * Y" on EVERY page; tagged for screen readers; text placed word by word in
 * the font of its own script (text.ts).
 *
 * What goes in: counts and money from buildSummary and replySpeed, team
 * members' names. What never does: a customer's name or number — the
 * "needs doing" lists are given as counts only, because a PDF is made to be
 * passed on.
 *
 * Safety rules from the Spending PDF review: every label and cell is
 * cleaned and capped; names go through cleanPersonName; amounts shrink to
 * fit (never an ellipsis); the logo is checked whole before pdfkit sees it,
 * and the catch sits inside the structure callback; the build has a time
 * limit.
 */
import PDFDocument from 'pdfkit'
import { formatAmount } from '@/lib/format/money'
import { imageProblem } from '@/lib/files/image-size'
import { cleanPersonName } from '@/lib/auth/person-name'
import type { Money, ReportSummary } from '../summary'
import type { ReplySpeed, SpeedBucket } from '../reply-speed'
import { isRtlLanguage, t, type Key } from '../i18n'
import { line, paragraph } from './text'
import { pdfkitProblem } from './logo-check'
import type { PdfBusiness } from './spending-pdf'

export interface LeadsPdfInput {
  summary: ReportSummary
  speed: ReplySpeed | null
  period: { firstDay: string; lastDay: string; timeZone: string }
  business: PdfBusiness
  language: string
  generatedAt: Date
  timeZone: string
}

const CRM_NAME = 'Lead Magnet CRM'
const M = 40
const W = 595.28
const H = 841.89
const CW = W - 2 * M
const FOOT = 44
const MAX_TABLE_ROWS = 200
const PDF_TIMEOUT_MS = 30_000
const RH = 16

const INK = '#1f2937'
const MUTED = '#6b7280'
const BRAND = '#4338ca'
const SOFT = '#eef2ff'
const SOFT_LINE = '#c7d2fe'
const WARN = '#92400e'

const num = (n: number) => new Intl.NumberFormat('en-IN').format(n)
const clean = (s: string, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—')

function moneyList(list: Money[]): string {
  const real = list.filter((m) => m.amount > 0)
  return real.length ? real.map((m) => formatAmount(m.amount, m.currency)).join(' + ') : '—'
}

/** "whatsapp" → "Whatsapp", "website_form" → "Website form": a stored key read as words. */
const sourceName = (s: string) => {
  const words = s.replace(/[_-]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : s
}

const SPEED_KEY: Record<SpeedBucket, Key> = { min5: 'lMin5', hour1: 'lHour1', day1: 'lDay1', later: 'lLater', none: 'lNone' }

type Col = { label: string; frac: number; align: 'left' | 'right' }
type Struct = { add(c: unknown): void; end(): void }
type Tagged = {
  struct(type: string, opts?: Record<string, unknown>, fn?: () => void): Struct
  addStructure(el: unknown): void
  markContent(tag: string, opts?: Record<string, unknown>): void
  endMarkedContent(): void
}

export async function buildLeadsPdf(input: LeadsPdfInput): Promise<Buffer> {
  const { summary: s, speed, period, business, language, generatedAt, timeZone } = input
  const rtl = isRtlLanguage(language)
  const tr = (key: Key, params?: Record<string, string | number>) => t(language, key, params)
  const start = rtl ? 'right' : 'left'
  const end = rtl ? 'left' : 'right'
  const name = clean(business.name, 120) || CRM_NAME

  const doc = new PDFDocument({
    size: 'A4',
    margin: M,
    bufferPages: true,
    tagged: true,
    displayTitle: true,
    lang: language === 'en' ? 'en-US' : language,
    pdfVersion: '1.7',
    ...({ subset: 'PDF/UA' } as Record<string, unknown>),
    info: { Title: tr('lTitle'), Author: name, Creator: CRM_NAME, Subject: tr('lTitle') },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const d = doc as unknown as Tagged
  const root = d.struct('Document')
  d.addStructure(root)
  const tag = (parent: Struct, type: string, opts: Record<string, unknown>, fn: () => void) => parent.add(d.struct(type, opts, fn))
  const open = (parent: Struct, type: string) => {
    const el = d.struct(type)
    parent.add(el)
    return el
  }
  const artifact = (type: string, fn: () => void) => {
    d.markContent('Artifact', { type })
    fn()
    d.endMarkedContent()
  }

  let y = M
  const ensure = (h: number) => {
    if (y + h > H - M - FOOT) {
      doc.addPage()
      y = M
      return true
    }
    return false
  }

  // ── header: logo, business name, address, tax number ───────────────
  const logoProblem = business.logo ? (imageProblem(business.logo.mime, business.logo.bytes) ?? pdfkitProblem(business.logo.bytes)) : null
  if (logoProblem) console.error('[leads-pdf] logo skipped:', logoProblem)
  const logo = business.logo && !logoProblem ? business.logo : null
  const textW = logo ? CW - 64 : CW
  const textX = logo && !rtl ? M + 64 : M
  const logoX = rtl ? W - M - 48 : M
  if (logo) {
    // The catch stays INSIDE the structure callback, or a throw leaves the element open.
    tag(root, 'Figure', { alt: `${name} logo` }, () => {
      try {
        doc.image(logo.bytes, logoX, y, { fit: [48, 48] })
      } catch (err) {
        console.error('[leads-pdf] logo skipped:', err instanceof Error ? err.message : String(err))
      }
    })
  }
  tag(root, 'H1', {}, () => line(doc, name, textX, y, { size: 14, bold: true, color: BRAND, width: textW, align: start }))
  let hy = y + 20
  const headerLines = business.lines.map((l) => clean(l, 160)).filter(Boolean).slice(0, 4)
  if (business.taxId) headerLines.push(clean(tr('taxId', { id: business.taxId }), 120))
  for (const l of headerLines) {
    tag(root, 'P', {}, () => line(doc, l, textX, hy, { size: 8.5, color: MUTED, width: textW, align: start }))
    hy += 12
  }
  y = Math.max(hy, y + 52) + 6
  artifact('Layout', () => doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.8).strokeColor(SOFT_LINE).stroke())
  y += 12

  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(generatedAt).replace(',', '')
  tag(root, 'H2', {}, () => line(doc, tr('lTitle'), M, y, { size: 18, bold: true, color: INK, width: CW, align: start }))
  y += 26
  const days = period.firstDay === period.lastDay ? period.firstDay : `${period.firstDay} – ${period.lastDay}`
  const periodText = `${tr('period')}: ${days} · ${period.timeZone}   ·   ${tr('generatedOn', { date: `${stamp} ${timeZone}` })}`
  tag(root, 'P', {}, () => line(doc, periodText, M, y, { size: 8.5, color: MUTED, width: CW, align: start }))
  y += 22

  // ── six figure cards ───────────────────────────────────────────────
  const kpis: Array<[string, string, string]> = [
    [tr('lLeads'), num(s.cohort.total), tr('lBefore', { n: num(s.previousCohort.total) })],
    [tr('lWon'), num(s.wonInPeriod), tr('lBefore', { n: num(s.previousWonInPeriod) })],
    [tr('lLost'), num(s.lostInPeriod), ''],
    [tr('lOpen'), num(s.cohort.open), ''],
    [tr('lRevenue'), moneyList(s.revenue), tr('lBefore', { n: moneyList(s.previousRevenue) })],
    [tr('lPipeline'), moneyList(s.pipeline), tr('lDeals', { n: num(s.pipeline.reduce((a, m) => a + m.deals, 0)) })],
  ]
  const kw = (CW - 2 * 10) / 3
  const kh = 58
  ensure(2 * kh + 10)
  kpis.forEach(([label, value, sub], i) => {
    const col = rtl ? 2 - (i % 3) : i % 3
    const kx = M + col * (kw + 10)
    const ky = y + Math.floor(i / 3) * (kh + 10)
    artifact('Layout', () => doc.roundedRect(kx, ky, kw, kh, 6).fillAndStroke(SOFT, SOFT_LINE))
    tag(root, 'P', {}, () => {
      line(doc, label, kx + 8, ky + 8, { size: 8, color: BRAND, width: kw - 16, align: start, shrinkTo: 6 })
      line(doc, value, kx + 8, ky + 22, { size: 13, bold: true, color: INK, width: kw - 16, align: start, shrinkTo: 6.5 })
      if (sub) line(doc, sub, kx + 8, ky + 42, { size: 7.5, color: MUTED, width: kw - 16, align: start, shrinkTo: 5.5 })
    })
  })
  y += 2 * kh + 10 + 14

  const section = (title: string) => {
    ensure(40)
    tag(root, 'H3', {}, () => line(doc, title, M, y, { size: 11, bold: true, color: INK, width: CW, align: start }))
    y += 18
  }
  const nothing = () => {
    tag(root, 'P', {}, () => line(doc, tr('nothing'), M, y, { size: 9, color: MUTED, width: CW, align: start }))
    y += 20
  }

  // ── needs doing now: counts only, never a customer ─────────────────
  section(tr('lSecTodo'))
  const todo: string[] = []
  if (s.leaks.neverContacted.count) todo.push(tr('lTodoNever', { n: num(s.leaks.neverContacted.count) }))
  if (s.leaks.waitingChats.count) todo.push(tr('lTodoChats', { n: num(s.leaks.waitingChats.count) }))
  if (s.leaks.overdueFollowUps.count) todo.push(tr('lTodoFollow', { n: num(s.leaks.overdueFollowUps.count) }))
  if (s.scope === 'team' && s.leaks.unassigned.count) todo.push(tr('lTodoUnassigned', { n: num(s.leaks.unassigned.count) }))
  if (todo.length === 0) {
    tag(root, 'P', {}, () => line(doc, tr('lTodoNone'), M, y, { size: 9, color: MUTED, width: CW, align: start }))
    y += 18
  } else {
    for (const item of todo) {
      ensure(16)
      tag(root, 'P', {}, () => line(doc, `• ${item}`, M, y, { size: 9.5, color: WARN, width: CW, align: start, shrinkTo: 7 }))
      y += 15
    }
    tag(root, 'P', {}, () => line(doc, tr('lOlder', { h: s.leakHours }), M, y, { size: 8, color: MUTED, width: CW, align: start }))
    y += 18
  }

  // ── tables, heading repeated on each page ──────────────────────────
  const table = (title: string, cols0: Col[], data0: string[][]) => {
    section(title)
    if (data0.length === 0) return nothing()
    const cols = rtl ? cols0.slice().reverse().map((c) => ({ ...c, align: (c.align === 'right' ? 'left' : 'right') as 'left' | 'right' })) : cols0
    const data = rtl ? data0.map((row) => row.slice().reverse()) : data0
    const cellText = (label: string, x: number, w: number, a: 'left' | 'right') =>
      line(doc, label, x + 5, y + 4, { size: 8, bold: true, color: '#ffffff', width: w - 10, align: a, shrinkTo: 6 })
    const head = (parent: Struct | null) => {
      doc.rect(M, y, CW, RH).fill(BRAND)
      let cx = M
      if (parent) {
        const row = open(parent, 'TR')
        for (const c of cols) {
          const w = CW * c.frac
          const x0 = cx
          tag(row, 'TH', { scope: 'Column' }, () => cellText(c.label, x0, w, c.align))
          cx += w
        }
        row.end()
      } else {
        // A heading repeated on a later page is decoration, not new content.
        artifact('Layout', () => {
          for (const c of cols) {
            const w = CW * c.frac
            cellText(c.label, cx, w, c.align)
            cx += w
          }
        })
      }
      y += RH
    }
    const tbl = d.struct('Table')
    root.add(tbl)
    ensure(RH * 2)
    head(tbl)
    data.slice(0, MAX_TABLE_ROWS).forEach((cells, i) => {
      if (ensure(RH)) head(null)
      const row = open(tbl, 'TR')
      if (i % 2) artifact('Layout', () => doc.rect(M, y, CW, RH).fill('#f5f7ff'))
      let cx = M
      cols.forEach((c, ci) => {
        const w = CW * c.frac
        const x0 = cx
        tag(row, 'TD', {}, () => line(doc, clean(cells[ci] ?? '', 160), x0 + 5, y + 4, { size: 8, color: INK, width: w - 10, align: c.align, shrinkTo: 5.5 }))
        cx += w
      })
      row.end()
      y += RH
    })
    tbl.end()
    y += 12
  }

  if (s.funnel.length > 0) {
    const top = s.funnel[0]?.count ?? 0
    table(tr('lSecFunnel'), [
      { label: tr('lColStage'), frac: 0.56, align: 'left' }, { label: tr('lColReached'), frac: 0.22, align: 'right' }, { label: tr('lColShare'), frac: 0.22, align: 'right' },
    ], s.funnel.map((f) => [clean(f.label, 80), num(f.count), pct(f.count, top)]))
  }

  table(tr('lSecSource'), [
    { label: tr('lColSource'), frac: 0.4, align: 'left' }, { label: tr('lColLeads'), frac: 0.2, align: 'right' }, { label: tr('lColWon'), frac: 0.2, align: 'right' }, { label: tr('lColWonPct'), frac: 0.2, align: 'right' },
  ], s.bySource.map((x) => [x.source === 'Unknown' ? tr('lUnknown') : sourceName(clean(x.source, 80)), num(x.total), num(x.won), pct(x.won, x.total)]))

  table(tr('lSecLost'), [
    { label: tr('lColReason'), frac: 0.75, align: 'left' }, { label: tr('lColCount'), frac: 0.25, align: 'right' },
  ], s.lostReasons.map((x) => [clean(x.reason, 120), num(x.count)]))

  table(tr('lSecPipeline'), [
    { label: tr('lColPipeline'), frac: 0.3, align: 'left' }, { label: tr('lColStage'), frac: 0.3, align: 'left' }, { label: tr('lColDeals'), frac: 0.15, align: 'right' }, { label: tr('colAmount'), frac: 0.25, align: 'right' },
  ], s.pipelineByStage.map((x) => [clean(x.pipeline, 80), clean(x.stage, 80), num(x.deals), formatAmount(x.amount, x.currency)]))

  table(tr('lSecCategory'), [
    { label: tr('colCategory'), frac: 0.5, align: 'left' }, { label: tr('lColDeals'), frac: 0.2, align: 'right' }, { label: tr('colAmount'), frac: 0.3, align: 'right' },
  ], s.byCategory.map((x) => [clean(x.category, 80), num(x.deals), formatAmount(x.amount, x.currency)]))

  const speedRows = speed?.countedSince ? speed.rows : []
  if (speedRows.some((r) => r.leads > 0)) {
    table(tr('lSecSpeed'), [
      { label: tr('lColSpeed'), frac: 0.5, align: 'left' }, { label: tr('lColLeads'), frac: 0.25, align: 'right' }, { label: tr('lColWonPct'), frac: 0.25, align: 'right' },
    ], speedRows.map((r) => [tr(SPEED_KEY[r.bucket]), num(r.leads), r.winRate == null ? (r.leads ? tr('lTooFew') : '—') : `${r.winRate}%`]))
  }

  table(tr('lSecTeam'), [
    { label: tr('colName'), frac: 0.2, align: 'left' }, { label: tr('lColLeads'), frac: 0.1, align: 'right' }, { label: tr('colCalls'), frac: 0.1, align: 'right' },
    { label: tr('lColConnected'), frac: 0.13, align: 'right' }, { label: tr('lColWon'), frac: 0.1, align: 'right' }, { label: tr('lColLost'), frac: 0.11, align: 'right' },
    { label: tr('lColOverdue'), frac: 0.11, align: 'right' }, { label: tr('lColReply'), frac: 0.15, align: 'right' },
  ], s.agents.map((a) => [
    cleanPersonName(a.name) || tr('formerMember'), num(a.leads), num(a.calls), pct(a.connected, a.calls), num(a.won), num(a.lost), num(a.overdueFollowUps),
    a.medianFirstReplyMinutes == null ? '—' : tr('lMinutes', { n: num(a.medianFirstReplyMinutes) }),
  ]))

  ensure(30)
  tag(root, 'P', {}, () => { y = paragraph(doc, tr('lNoteCredit'), M, y, CW, { size: 8, color: MUTED }) })

  root.end()

  // ── footer on EVERY page ───────────────────────────────────────────
  const range = doc.bufferedPageRange()
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p)
    const saved = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    artifact('Pagination', () => {
      doc.moveTo(M, H - 34).lineTo(W - M, H - 34).lineWidth(0.5).strokeColor(SOFT_LINE).stroke()
      line(doc, CRM_NAME, M, H - 26, { size: 8, bold: true, color: BRAND, width: CW, align: start })
      line(doc, tr('pageOf', { n: p + 1, total: range.count }), M, H - 26, { size: 8, color: MUTED, width: CW, align: end })
    })
    doc.page.margins.bottom = saved
  }
  doc.end()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The PDF took too long to build.')), PDF_TIMEOUT_MS)
  })
  try {
    return await Promise.race([finished, timeout])
  } finally {
    clearTimeout(timer)
  }
}
