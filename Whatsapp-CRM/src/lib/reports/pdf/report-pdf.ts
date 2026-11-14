/**
 * The owner's report as a detailed, landscape PDF with vector charts —
 * the same story as the slides (presentation-pptx.ts), one page per part,
 * drawn so it stays sharp when printed or zoomed:
 *
 *   1. Summary: business header, six figures against the period before,
 *      findings written by code, what needs doing (counts only).
 *   2. Ads at a glance: six cards and a spend-vs-conversations chart by
 *      day (bars on the left axis, a line on the right).
 *   3. Leads by category and day: the table and a bar of each category's
 *      share, plus leads by day.
 *   4. Funnel: a stepped funnel with counts and the share of the first
 *      stage, conversion between stages against the period before, and
 *      where leads came from.
 *   5. Team: the table (calls, attended, every stage, won) and a paired
 *      bar of calls against attended per person.
 *   6. Detail: first-answer speed against wins, why leads were lost,
 *      pipeline by stage and revenue by category.
 *
 * Rules kept from the Spending and Leads PDFs: every label and cell is
 * cleaned and capped; team names go through cleanPersonName; amounts shrink
 * to fit, never an ellipsis; the logo is checked whole and its catch sits
 * inside the structure callback; the CRM's name and "Page X of Y" are on
 * every page; the build has a time limit. No customer name or number.
 */
import PDFDocument from 'pdfkit'
import { formatAmount } from '@/lib/format/money'
import { imageProblem } from '@/lib/files/image-size'
import { cleanPersonName } from '@/lib/auth/person-name'
import type { Money } from '../summary'
import type { SpeedBucket } from '../reply-speed'
import type { PresentationData } from '../presentation'
import { isRtlLanguage, t, type Key } from '../i18n'
import { line, paragraph } from './text'
import { pdfkitProblem } from './logo-check'
import type { PdfBusiness } from './spending-pdf'

export interface ReportPdfInput {
  data: PresentationData
  business: PdfBusiness
  language: string
  generatedAt: Date
  /** First-answer speed rows, when measured. */
  speed?: { countedSince: string | null; rows: Array<{ bucket: SpeedBucket; leads: number; won: number; winRate: number | null }> } | null
}

const CRM_NAME = 'Lead Magnet CRM'
/** A4 landscape. */
const W = 841.89
const H = 595.28
const M = 36
const CW = W - 2 * M
const FOOT = 30
const PDF_TIMEOUT_MS = 30_000
const DEFAULT_BRAND = '4338ca'

const INK = '#1f2937'
const MUTED = '#6b7280'
const GRID = '#e5e7eb'
const GOOD = '#059669'
const BAD = '#b91c1c'
const GOLD = '#b7791f'

const num = (n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n))
/** Between two stage names; the PDF's fonts have no → glyph. */
const STEP = ' › '

/**
 * Cleaned and capped. Arrows the PDF fonts cannot draw (→ ▲ ▼, also inside
 * translated text such as "Settings → Ads") become characters they can.
 */
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s : s == null ? '' : String(s))
  // Bounded first, so no pattern below ever runs over a huge string.
  .slice(0, max * 4)
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/ ?→ ?/g, STEP)
  .replace(/▲\s*/g, '+')
  .replace(/▼\s*/g, '-')
  .replace(/\s+/g, ' ').trim().slice(0, max)
const pctText = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—')

function hexMix(hex: string, toward: number, amount: number): string {
  const h = /^[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRAND
  const mix = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount) + toward * amount).toString(16).padStart(2, '0')
  return `#${mix(0)}${mix(2)}${mix(4)}`
}
const tint = (hex: string, a: number) => hexMix(hex, 255, a)
const shade = (hex: string, a: number) => hexMix(hex, 0, a)

/**
 * A round top for a chart axis with four equal steps, each step 1, 2 or 5 ×
 * 10ⁿ — so a count axis reads 0 10 20 30 40, never 13 or 38. Pure.
 */
export function niceMax(v: number): number {
  if (!(v > 0)) return 4
  const raw = v / 4
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return Math.max(4, m * p * 4)
  return Math.max(4, 40 * p)
}

function moneyList(list: Money[]): string {
  const real = list.filter((m) => m.amount > 0)
  return real.length ? real.map((m) => formatAmount(m.amount, m.currency)).join(' + ') : '—'
}

/**
 * "+35%" / "-5%". Plain signs, not ▲▼: the PDF's fonts have no glyph for
 * the arrows (they printed as empty boxes).
 */
export function changeText(now: number, before: number): string | null {
  if (!(before > 0)) return null
  const c = Math.round(((now - before) / before) * 100)
  return c === 0 ? '0%' : `${c > 0 ? '+' : '-'}${Math.abs(c)}%`
}
/** "whatsapp" → "Whatsapp", "phone_call" → "Phone call": a stored key read as words. */
function sourceName(raw: string): string {
  const words = clean(raw.replace(/[_-]+/g, ' '), 30)
  return words ? words[0].toUpperCase() + words.slice(1) : raw
}

const SPEED_KEY: Record<SpeedBucket, Key> = { min5: 'lMin5', hour1: 'lHour1', day1: 'lDay1', later: 'lLater', none: 'lNone' }

type Struct = { add(c: unknown): void; end(): void }
type Tagged = {
  struct(type: string, opts?: Record<string, unknown>, fn?: () => void): Struct
  addStructure(el: unknown): void
  markContent(tag: string, opts?: Record<string, unknown>): void
  endMarkedContent(): void
}

export async function buildReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const { data, business, language, generatedAt, speed } = input
  const s = data.summary
  const rtl = isRtlLanguage(language)
  const tr = (key: Key, params?: Record<string, string | number>) => t(language, key, params)
  const start = rtl ? 'right' : 'left'
  const end = rtl ? 'left' : 'right'
  const brandHex = data.brandColor ?? DEFAULT_BRAND
  const BRAND = `#${brandHex}`
  const DARK = shade(brandHex, 0.35)
  const SOFT = tint(brandHex, 0.92)
  const SOFT_LINE = tint(brandHex, 0.75)
  const BAR = tint(brandHex, 0.45)
  const name = clean(business.name, 120) || CRM_NAME
  const currency = (data.ads.insights.status === 'ok' && data.ads.insights.totals.currency) || s.revenue[0]?.currency || 'INR'
  const money = (v: number | null) => (v == null ? '—' : formatAmount(v, currency))
  const tz = data.period.timeZone
  const range = data.period.firstDay === data.period.lastDay ? data.period.firstDay : `${data.period.firstDay} – ${data.period.lastDay}`

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: M,
    bufferPages: true,
    tagged: true,
    displayTitle: true,
    lang: language === 'en' ? 'en-US' : language,
    pdfVersion: '1.7',
    ...({ subset: 'PDF/UA' } as Record<string, unknown>),
    info: { Title: `${tr('lTitle')} · ${range}`, Author: name, Creator: CRM_NAME, Subject: tr('lTitle') },
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
  const tag = (type: string, opts: Record<string, unknown>, fn: () => void) => root.add(d.struct(type, opts, fn))
  const artifact = (fn: () => void) => {
    d.markContent('Artifact', { type: 'Layout' })
    fn()
    d.endMarkedContent()
  }
  const P = (str: string, x: number, y: number, o: Parameters<typeof line>[4] = {}) =>
    tag('P', {}, () => line(doc, clean(str, 400), x, y, { color: INK, align: start, ...o }))

  // ── logo, checked whole before pdfkit sees it ──────────────────────
  const logoProblem = business.logo ? (imageProblem(business.logo.mime, business.logo.bytes) ?? pdfkitProblem(business.logo.bytes)) : null
  if (logoProblem) console.error('[report-pdf] logo skipped:', logoProblem)
  const logo = business.logo && !logoProblem ? business.logo : null
  const drawLogo = (x: number, y: number, w: number, h: number) => {
    if (!logo) return
    tag('Figure', { alt: `${name} logo` }, () => {
      try {
        doc.image(logo.bytes, x, y, { fit: [w, h] })
      } catch (err) {
        console.error('[report-pdf] logo skipped:', err instanceof Error ? err.message : String(err))
      }
    })
  }

  /** Each part starts on its own page with the same title block. */
  let first = true
  const page = (title: string, sub: string | null): number => {
    if (!first) doc.addPage()
    first = false
    drawLogo(rtl ? M : W - M - 90, M - 4, 90, 40)
    const tw = CW - 110
    const tx = rtl ? M + 110 : M
    tag('H1', {}, () => line(doc, clean(title, 120), tx, M, { size: 20, bold: true, color: DARK, width: tw, align: start, shrinkTo: 14 }))
    if (sub) P(sub, tx, M + 26, { size: 10, color: MUTED, width: tw, shrinkTo: 8 })
    return M + 52
  }

  /** A figure card; `filled` uses the brand colour, 'gold' the pipeline colour. */
  const card = (x: number, y: number, w: number, h: number, label: string, value: string, sub: string | null, filled: boolean | 'gold' = false) => {
    const fill = filled === 'gold' ? GOLD : filled ? BRAND : SOFT
    artifact(() => doc.roundedRect(x, y, w, h, 7).fillAndStroke(fill, filled ? fill : SOFT_LINE))
    const fg = filled ? '#ffffff' : INK
    tag('P', {}, () => {
      line(doc, clean(value, 60), x + 10, y + 10, { size: 17, bold: true, color: fg, width: w - 20, align: start, shrinkTo: 9 })
      line(doc, clean(label, 60), x + 10, y + 34, { size: 9, bold: true, color: filled ? '#ffffff' : DARK, width: w - 20, align: start, shrinkTo: 6.5 })
      if (sub) line(doc, clean(sub, 80), x + 10, y + 48, { size: 7.5, color: filled ? '#ffffff' : MUTED, width: w - 20, align: start, shrinkTo: 5.5 })
    })
  }
  const cards = (y: number, items: Array<[string, string, string | null, boolean | 'gold']>, h = 66) => {
    const n = items.length
    const gap = 10
    const w = (CW - (n - 1) * gap) / n
    items.forEach(([label, value, sub, filled], i) => {
      const col = rtl ? n - 1 - i : i
      card(M + col * (w + gap), y, w, h, label, value, sub, filled)
    })
    return y + h + 16
  }

  const heading = (str: string, x: number, y: number, w: number) => {
    tag('H2', {}, () => line(doc, clean(str, 100), x, y, { size: 11.5, bold: true, color: INK, width: w, align: start, shrinkTo: 8 }))
    return y + 18
  }

  // ── vector charts ──────────────────────────────────────────────────
  /** Vertical bars with an optional line on a second axis. */
  const barLineChart = (o: {
    x: number; y: number; w: number; h: number; labels: string[]
    bars: number[]; barLabel: string; barFormat: (v: number) => string
    line?: number[]; lineLabel?: string
  }) => {
    const { x, y, w, h, labels } = o
    const axisW = 44
    const plotX = x + axisW
    const plotW = w - axisW * (o.line ? 2 : 1)
    const plotH = h - 34
    const n = Math.max(1, labels.length)
    const bMax = niceMax(Math.max(0, ...o.bars))
    const lMax = o.line ? niceMax(Math.max(0, ...o.line)) : 1
    const alt = `${o.barLabel}${o.line ? ` / ${o.lineLabel}` : ''}: ${labels.map((l, i) => `${l} ${o.barFormat(o.bars[i] ?? 0)}${o.line ? ` / ${o.line[i] ?? 0}` : ''}`).slice(0, 40).join(', ')}`
    tag('Figure', { alt }, () => {
      artifact(() => {
        for (let g = 0; g <= 4; g++) {
          const gy = y + plotH - (plotH * g) / 4
          doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).lineWidth(0.5).strokeColor(GRID).stroke()
        }
        const slot = plotW / n
        const bw = Math.min(46, slot * 0.62)
        o.bars.forEach((v, i) => {
          const bh = (Math.max(0, v) / bMax) * plotH
          doc.rect(plotX + i * slot + (slot - bw) / 2, y + plotH - bh, bw, bh).fill(BAR)
        })
        if (o.line) {
          const pts = o.line.map((v, i) => [plotX + i * slot + slot / 2, y + plotH - (Math.max(0, v) / lMax) * plotH] as const)
          pts.forEach(([px, py], i) => (i === 0 ? doc.moveTo(px, py) : doc.lineTo(px, py)))
          if (pts.length > 1) doc.lineWidth(2.2).strokeColor(BRAND).stroke()
          pts.forEach(([px, py]) => doc.circle(px, py, 3.4).fillAndStroke(BRAND, '#ffffff'))
        }
      })
    })
    // Axis numbers and day labels are text, so a reader can select them.
    const slot = plotW / n
    for (let g = 0; g <= 4; g++) {
      const gy = y + plotH - (plotH * g) / 4 - 4
      line(doc, o.barFormat((bMax * g) / 4), x, gy, { size: 7, color: MUTED, width: axisW - 6, align: 'right' })
      if (o.line) line(doc, num((lMax * g) / 4), plotX + plotW + 6, gy, { size: 7, color: BRAND, width: axisW - 6, align: 'left' })
    }
    const every = Math.ceil(n / 16)
    labels.forEach((l, i) => {
      if (i % every) return
      line(doc, clean(l, 12), plotX + i * slot, y + plotH + 5, { size: 7, color: MUTED, width: slot * every, align: 'center' })
    })
    if (o.line) {
      const ly = y + plotH + 5
      o.line.forEach((v, i) => {
        if (n > 16 || !v) return
        const py = y + plotH - (Math.max(0, v) / lMax) * plotH - 13
        line(doc, num(v), plotX + i * slot, Math.max(y, py), { size: 7.5, bold: true, color: DARK, width: slot, align: 'center' })
      })
      // legend
      artifact(() => {
        doc.rect(plotX, ly + 14, 9, 9).fill(BAR)
        doc.circle(plotX + plotW / 2, ly + 18.5, 3.5).fill(BRAND)
      })
      line(doc, o.barLabel, plotX + 13, ly + 14, { size: 8, color: MUTED, width: plotW / 2 - 20 })
      line(doc, o.lineLabel ?? '', plotX + plotW / 2 + 8, ly + 14, { size: 8, color: MUTED, width: plotW / 2 - 20 })
    }
  }

  /** Horizontal bars with a label, a value and an optional second value. */
  const hBars = (x: number, y: number, w: number, rows: Array<{ label: string; value: number; right: string; color?: string }>, rowH = 18) => {
    const labelW = Math.min(170, w * 0.36)
    const rightW = 92
    const barW = w - labelW - rightW - 12
    const max = Math.max(1, ...rows.map((r) => r.value))
    const alt = rows.map((r) => `${r.label} ${r.right}`).slice(0, 30).join(', ')
    tag('Figure', { alt }, () => {
      artifact(() => {
        rows.forEach((r, i) => {
          const by = y + i * rowH + 4
          doc.roundedRect(x + labelW + 6, by, barW, rowH - 8, 3).fill(SOFT)
          const bw = Math.max(r.value > 0 ? 3 : 0, (r.value / max) * barW)
          if (bw > 0) doc.roundedRect(x + labelW + 6, by, bw, rowH - 8, 3).fill(r.color ?? BRAND)
        })
      })
    })
    rows.forEach((r, i) => {
      const ty = y + i * rowH + 3
      line(doc, clean(r.label, 60), x, ty, { size: 8.5, color: INK, width: labelW, align: start, shrinkTo: 6.5 })
      line(doc, clean(r.right, 40), x + labelW + barW + 12, ty, { size: 8.5, bold: true, color: DARK, width: rightW, align: 'right', shrinkTo: 6 })
    })
    return y + rows.length * rowH + 6
  }

  /** A table: header row in the brand's dark tone, banded rows, totals optional. */
  const table = (x: number, y: number, w: number, cols: Array<{ label: string; frac: number; align: 'left' | 'right' | 'center' }>, rows: Array<{ cells: string[]; bold?: boolean; colors?: Array<string | null> }>, rowH = 17) => {
    const cs = rtl ? cols.slice().reverse() : cols
    const rs = rtl ? rows.map((r) => ({ ...r, cells: r.cells.slice().reverse(), colors: r.colors?.slice().reverse() })) : rows
    const tbl = d.struct('Table')
    root.add(tbl)
    const drawRow = (cells: string[], ry: number, header: boolean, bold: boolean, colors?: Array<string | null>) => {
      const tr2 = d.struct('TR')
      tbl.add(tr2)
      let cx = x
      cs.forEach((c, ci) => {
        const cw = w * c.frac
        const x0 = cx
        tr2.add(d.struct(header ? 'TH' : 'TD', header ? { scope: 'Column' } : {}, () =>
          line(doc, clean(cells[ci] ?? '', 120), x0 + 5, ry + 4.5, { size: 8.2, bold: header || bold, color: header ? '#ffffff' : colors?.[ci] ?? INK, width: cw - 10, align: c.align, shrinkTo: 5.5 })))
        cx += cw
      })
      tr2.end()
    }
    artifact(() => doc.rect(x, y, w, rowH).fill(DARK))
    drawRow(cs.map((c) => c.label), y, true, true)
    rs.forEach((r, i) => {
      const ry = y + (i + 1) * rowH
      if (ry + rowH > H - M - FOOT) return
      artifact(() => doc.rect(x, ry, w, rowH).fill(r.bold ? SOFT_LINE : i % 2 ? SOFT : '#ffffff'))
      drawRow(r.cells, ry, false, Boolean(r.bold), r.colors)
    })
    tbl.end()
    return y + (rs.length + 1) * rowH + 8
  }

  const nothing = (x: number, y: number, w: number) => {
    P(tr('nothing'), x, y, { size: 9, color: MUTED, width: w })
    return y + 18
  }

  // ════ 1. summary ═══════════════════════════════════════════════════
  {
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(generatedAt).replace(',', '')
    let y = page(name, `${tr('lTitle')} · ${range} · ${tz} · ${tr('generatedOn', { date: `${stamp} ${tz}` })}`)
    const headerLines = business.lines.map((l) => clean(l, 160)).filter(Boolean).slice(0, 2)
    if (business.taxId) headerLines.push(clean(tr('taxId', { id: business.taxId }), 120))
    if (headerLines.length) {
      P(headerLines.join('   ·   '), M, y - 10, { size: 8, color: MUTED, width: CW })
      y += 8
    }
    const before = (now: number, prev: number) => {
      const c = changeText(now, prev)
      return c ? `${c} · ${tr('lBefore', { n: num(prev) })}` : tr('lBefore', { n: num(prev) })
    }
    y = cards(y, [
      [tr('lLeads'), num(s.cohort.total), before(s.cohort.total, s.previousCohort.total), false],
      [tr('lWon'), num(s.wonInPeriod), before(s.wonInPeriod, s.previousWonInPeriod), false],
      [tr('lLost'), num(s.lostInPeriod), null, false],
      [tr('lOpen'), num(s.cohort.open), null, false],
      [tr('lRevenue'), moneyList(s.revenue), tr('lBefore', { n: moneyList(s.previousRevenue) }), true],
      [tr('lPipeline'), moneyList(s.pipeline), tr('lDeals', { n: num(s.pipeline.reduce((a, m) => a + m.deals, 0)) }), 'gold'],
    ], 74)

    // leads by day (small chart) on the left, needs doing on the right
    const half = (CW - 24) / 2
    const lx = rtl ? M + half + 24 : M
    const rx = rtl ? M : M + half + 24
    const ly = heading(tr('lLeads'), lx, y, half)
    const labels = data.period.days.map((dd) => String(Number(dd.slice(8, 10))))
    barLineChart({ x: lx, y: ly, w: half, h: 170, labels, bars: data.categories.dayTotals, barLabel: tr('lLeads'), barFormat: num })

    let ry = heading(tr('lSecTodo'), rx, y, half)
    const todo: Array<[string, number]> = [
      [tr('lTodoNever', { n: num(s.leaks.neverContacted.count) }), s.leaks.neverContacted.count],
      [tr('lTodoChats', { n: num(s.leaks.waitingChats.count) }), s.leaks.waitingChats.count],
      [tr('lTodoFollow', { n: num(s.leaks.overdueFollowUps.count) }), s.leaks.overdueFollowUps.count],
      [tr('lTodoUnassigned', { n: num(s.leaks.unassigned.count) }), s.leaks.unassigned.count],
    ]
    const live = todo.filter(([, c]) => c > 0)
    if (live.length === 0) {
      P(tr('lTodoNone'), rx, ry, { size: 10, color: GOOD, bold: true, width: half })
      ry += 20
    } else {
      for (const [txt] of live) {
        artifact(() => doc.circle(rtl ? rx + half - 4 : rx + 4, ry + 6, 3).fill(BAD))
        P(txt, rtl ? rx : rx + 14, ry, { size: 10, width: half - 14, shrinkTo: 7 })
        ry += 18
      }
      P(tr('lOlder', { h: s.leakHours }), rx, ry, { size: 8, color: MUTED, width: half })
      ry += 20
    }
    // findings: written by code from the numbers
    const findings: string[] = []
    const topCat = data.categories.rows[0]
    if (topCat && data.categories.total > 0) findings.push(`${clean(data.categoryLabel, 30) || tr('pCategory')}: ${clean(topCat.label || tr('pNotSet'), 40)} — ${num(topCat.total)} (${topCat.share}%)`)
    const best = data.funnel.conversions.find((c) => c.rate != null)
    if (best) findings.push(`${clean(best.from, 24)} → ${clean(best.to, 24)}: ${best.rate}%${best.previousRate != null ? ` (${tr('pPrevWas', { p: `${best.previousRate}%` })})` : ''}`)
    if (data.speedFinding) findings.push(data.speedFinding)
    if (s.lostReasons[0]) findings.push(`${tr('lSecLost')}: ${clean(s.lostReasons[0].reason, 60)} (${num(s.lostReasons[0].count)})`)
    if (findings.length) {
      ry = heading(tr('pFindings'), rx, ry + 6, half)
      for (const f of findings.slice(0, 4)) {
        tag('P', {}, () => { ry = paragraph(doc, `• ${clean(f, 200)}`, rx, ry, half, { size: 9, color: INK }) + 4 })
      }
    }
  }

  // ════ 2. ads at a glance ═══════════════════════════════════════════
  {
    const ads = data.ads
    const ok = ads.insights.status === 'ok' ? ads.insights : null
    const prev = ads.previous.status === 'ok' ? ads.previous : null
    const days = data.period.days.length
    const sub = [tr('pChannels'), tr('pDaysN', { n: days }), ads.activeAds ? tr('pActiveAds', { n: ads.activeAds }) : null].filter(Boolean).join('  •  ')
    let y = page(tr('pAdsTitle'), sub)
    const spend = ok?.totals.spend ?? null
    const ctr = ok && ok.totals.impressions > 0 ? `${((ok.totals.clicks / ok.totals.impressions) * 100).toFixed(2)}%` : '—'
    const cpc = ok && ok.totals.clicks > 0 ? money(ok.totals.spend / ok.totals.clicks) : '—'
    const cpConv = ok && ads.conversations > 0 ? ok.totals.spend / ads.conversations : null
    const prevCp = prev && ads.previousConversations > 0 ? prev.totals.spend / ads.previousConversations : null
    const vs = (c: string | null) => (c ? tr('pVsLast', { d: c }) : null)
    y = cards(y, [
      [tr('pSpent'), money(spend), spend != null ? tr('pPerDayAvg', { v: money(spend / Math.max(1, days)) }) : null, false],
      [tr('pReach'), ok ? num(ok.totals.reach) : '—', ok && prev ? vs(changeText(ok.totals.reach, prev.totals.reach)) : null, false],
      [tr('pImpressions'), ok ? num(ok.totals.impressions) : '—', ok?.totals.frequency != null ? tr('pFrequency', { v: ok.totals.frequency }) : null, false],
      [tr('pClicks'), ok ? num(ok.totals.clicks) : '—', ok ? tr('pCtr', { p: ctr, c: cpc }) : null, false],
      [tr('pConversations'), num(ads.conversations), vs(changeText(ads.conversations, ads.previousConversations)), true],
      [tr('pCostPerConv'), money(cpConv), cpConv != null && prevCp != null ? vs(changeText(cpConv, prevCp)) : null, true],
    ], 74)
    if (!ok) {
      P(ads.insights.status === 'error' ? ads.insights.message : tr('pNotConnected'), M, y - 6, { size: 9, color: GOLD, width: CW })
      y += 12
    }
    // Without spend the chart shows conversations only, and its title says so.
    y = heading(ok ? tr('pChartDaily') : tr('pConvSeries'), M, y, CW)
    const spendBy = new Map((ok?.byDay ?? []).map((x) => [x.day, x.spend]))
    const labels = data.period.days.map((dd) => `${Number(dd.slice(8, 10))}/${Number(dd.slice(5, 7))}`)
    barLineChart({
      x: M, y, w: CW, h: H - M - FOOT - y - 6, labels,
      bars: ok ? data.period.days.map((dd) => spendBy.get(dd) ?? 0) : ads.conversationsByDay,
      barLabel: ok ? tr('pSpendSeries') : tr('pConvSeries'),
      barFormat: ok ? (v) => formatAmount(v, currency).replace(/\.00$/, '') : num,
      line: ok ? ads.conversationsByDay : undefined,
      lineLabel: tr('pConvSeries'),
    })
  }

  // ════ 3. leads by category and day ═════════════════════════════════
  {
    const cat = data.categories
    const label = clean(data.categoryLabel, 40) || tr('pCategory')
    const ch = changeText(cat.total, cat.previousTotal)
    let y = page(tr('pCatTitle', { label }), ch ? tr('pCatSub', { n: num(cat.total), d: ch, m: num(cat.previousTotal) }) : `${num(cat.total)} ${tr('lLeads')}`)
    if (cat.total === 0) {
      nothing(M, y, CW)
    } else {
      const days = data.period.days
      const weekly = days.length > 14
      const groups = weekly ? Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7)) : days.map((dd) => [dd])
      const sum = (byDay: number[], g: string[]) => g.reduce((a, dd) => a + (byDay[days.indexOf(dd)] ?? 0), 0)
      const glabel = (g: string[]) => (weekly ? `${Number(g[0].slice(8, 10))}/${Number(g[0].slice(5, 7))}–${Number(g[g.length - 1].slice(8, 10))}/${Number(g[g.length - 1].slice(5, 7))}` : `${Number(g[0].slice(8, 10))}/${Number(g[0].slice(5, 7))}`)
      const tableW = groups.length > 10 ? CW : CW * 0.64
      const firstFrac = Math.min(0.3, 160 / tableW)
      const rest = (1 - firstFrac) / (groups.length + 2)
      const cols = [
        { label, frac: firstFrac, align: 'left' as const },
        ...groups.map((g) => ({ label: glabel(g), frac: rest, align: 'center' as const })),
        { label: tr('pTotal'), frac: rest, align: 'center' as const },
        { label: tr('pShare'), frac: rest, align: 'center' as const },
      ]
      const avg = cat.total / Math.max(1, groups.length)
      const rows = cat.rows.slice(0, 18).map((r) => ({
        cells: [r.label || tr('pNotSet'), ...groups.map((g) => (sum(r.byDay, g) ? num(sum(r.byDay, g)) : '–')), num(r.total), `${r.share}%`],
      }))
      rows.push({
        bold: true,
        cells: [tr('pTotal'), ...groups.map((g) => num(sum(cat.dayTotals, g))), num(cat.total), '100%'],
        colors: [null, ...groups.map((g) => (sum(cat.dayTotals, g) < avg * 0.6 ? BAD : null)), null, null],
      } as never)
      const tx = rtl ? M + CW - tableW : M
      const top = y
      y = table(tx, y, tableW, cols, rows)
      if (groups.length <= 10) {
        // Each category's share as bars beside the table.
        const bx = rtl ? M : M + tableW + 24
        const bw = CW - tableW - 24
        const by = heading(tr('pShare'), bx, top, bw)
        hBars(bx, by, bw, cat.rows.slice(0, 12).map((r, i) => ({ label: r.label || tr('pNotSet'), value: r.total, right: `${num(r.total)} · ${r.share}%`, color: tint(brandHex, Math.min(0.7, i * 0.08)) })))
      }
      // Leads by day under the table, when there is room for a chart.
      const room = H - M - FOOT - y - 26
      if (room > 140) {
        y = heading(`${tr('lLeads')} · ${range}`, M, y + 4, CW)
        barLineChart({ x: M, y, w: CW, h: Math.min(room, 230), labels: days.map((dd) => `${Number(dd.slice(8, 10))}/${Number(dd.slice(5, 7))}`), bars: cat.dayTotals, barLabel: tr('lLeads'), barFormat: num })
      }
    }
  }

  // ════ 4. funnel ════════════════════════════════════════════════════
  {
    const f = data.funnel
    const open = f.stages.filter((st) => st.outcome !== 'lost')
    const wonStage = [...open].reverse().find((st) => st.outcome === 'won')
    const count = (key: string) => f.rows.find((r) => r.key === key)?.count ?? 0
    const pipeDeals = s.pipeline.reduce((a, m) => a + m.deals, 0)
    let y = page(tr('pFunnelTitle'), wonStage
      ? tr('pFunnelSub', { leads: num(s.cohort.total), won: num(count(wonStage.key)), wonLabel: clean(wonStage.label, 30), pipe: num(pipeDeals) })
      : `${num(s.cohort.total)} ${tr('lLeads')}`)
    const notConn = Math.max(0, s.calls.total - s.calls.connected)
    y = cards(y, [
      [tr('pTotalLeads'), num(s.cohort.total), range, false],
      [tr('pCallsDone'), num(s.calls.total), tr('pLeadsPlusFollow'), false],
      [tr('pAttended'), num(s.calls.connected), tr('pOfCalls', { p: pctText(s.calls.connected, s.calls.total) }), false],
      [tr('pNotAttended'), num(notConn), tr('pOfCalls', { p: pctText(notConn, s.calls.total) }), false],
      [tr('pPipelineDeals'), num(pipeDeals), moneyList(s.pipeline) === '—' ? null : moneyList(s.pipeline), 'gold'],
    ])
    const leftW = CW * 0.58
    const rightW = CW - leftW - 24
    const lx = rtl ? M + rightW + 24 : M
    const rx = rtl ? M : M + leftW + 24
    const ly = heading(tr('lSecFunnel'), lx, y, leftW)
    if (open.length === 0) {
      P(tr('pNoStages'), lx, ly, { size: 10, color: MUTED, width: leftW })
    } else {
      // A stepped funnel: each stage a centred bar, width by its count.
      const top = Math.max(1, s.cohort.total, ...open.map((st) => count(st.key)))
      const stageSteps = open.map((st) => ({ label: clean(st.label, 30), value: count(st.key), won: st.outcome === 'won' }))
      // "All leads" on top only when the first stage does not already hold them all.
      const steps = (stageSteps[0] && stageSteps[0].value >= s.cohort.total ? stageSteps : [{ label: tr('pTotalLeads'), value: s.cohort.total, won: false }, ...stageSteps]).slice(0, 8)
      const stepH = Math.min(34, (H - M - FOOT - ly - 10) / steps.length)
      const alt = steps.map((st) => `${st.label} ${num(st.value)}`).join(', ')
      tag('Figure', { alt }, () => {
        artifact(() => {
          steps.forEach((st, i) => {
            const bw = Math.max(40, (st.value / top) * (leftW - 150))
            const bx = lx + 150 + (leftW - 150 - bw) / 2
            doc.roundedRect(bx, ly + i * stepH + 3, bw, stepH - 6, 4).fill(st.won ? GOOD : tint(brandHex, Math.min(0.6, i * 0.1)))
          })
        })
      })
      steps.forEach((st, i) => {
        const sy = ly + i * stepH + stepH / 2 - 5
        line(doc, st.label, lx, sy, { size: 9, color: INK, width: 145, align: start, shrinkTo: 6.5 })
        line(doc, `${num(st.value)} · ${pctText(st.value, s.cohort.total)}`, lx + 150, sy, { size: 8.5, bold: true, color: '#ffffff', width: leftW - 150, align: 'center', shrinkTo: 6 })
      })
    }
    // conversion panel
    let ry = y
    const panelH = 150
    artifact(() => doc.roundedRect(rx, ry, rightW, panelH, 8).fill(DARK))
    P(tr('pConversion'), rx + 14, ry + 10, { size: 10, bold: true, color: tint(GOLD.slice(1), 0.3), width: rightW - 28 })
    const conv: Array<[string, string, string | null]> = f.conversions.slice(0, 3).map((c) => [`${clean(c.from, 18)} → ${clean(c.to, 18)}`, c.rate == null ? '—' : `${c.rate}%`, c.previousRate == null ? null : tr('pPrevWas', { p: `${c.previousRate}%` })])
    conv.push([tr('pAttendRate'), f.attendRate == null ? '—' : `${f.attendRate}%`, null])
    conv.slice(0, 4).forEach(([lbl, val, sub2], i) => {
      const cy = ry + 32 + i * 29
      P(lbl, rx + 14, cy, { size: 8.5, color: '#ffffff', width: rightW - 100, shrinkTo: 6 })
      if (sub2) P(sub2, rx + 14, cy + 11, { size: 7, color: tint(brandHex, 0.7), width: rightW - 100 })
      P(val, rx + rightW - 84, cy - 2, { size: 15, bold: true, color: '#ffffff', width: 70, align: 'right' })
    })
    ry += panelH + 16
    ry = heading(tr('lSecSource'), rx, ry, rightW)
    const src = s.bySource.slice(0, 8)
    if (src.length === 0) nothing(rx, ry, rightW)
    else hBars(rx, ry, rightW, src.map((x) => ({ label: x.source === 'Unknown' ? tr('lUnknown') : sourceName(x.source), value: x.total, right: `${num(x.total)} · ${pctText(x.won, x.total)}` })), 16)
  }

  // ════ 5. team ══════════════════════════════════════════════════════
  {
    let y = page(tr('lSecTeam'), range)
    const open = data.funnel.stages.filter((st) => st.outcome !== 'lost').slice(0, 5)
    const team = data.team.filter((m) => m.calls + m.won + m.stages.reduce((a, b) => a + b, 0) > 0).slice(0, 14)
    if (team.length === 0) {
      P(tr('pNoTeam'), M, y, { size: 10, color: MUTED, width: CW })
    } else {
      const extra = open.length
      const fixed = 5
      const unit = 1 / (fixed + extra + 1.6)
      const cols = [
        { label: tr('pTeamMember'), frac: unit * 1.6, align: 'left' as const },
        { label: tr('pCalls'), frac: unit, align: 'center' as const },
        { label: tr('pAttended'), frac: unit, align: 'center' as const },
        { label: tr('pNotAttended'), frac: unit, align: 'center' as const },
        { label: tr('pAttendPct'), frac: unit, align: 'center' as const },
        ...open.map((st) => ({ label: clean(st.label, 20), frac: unit, align: 'center' as const })),
        { label: tr('pWon'), frac: unit, align: 'center' as const },
      ]
      const rows = team.map((m) => {
        const att = m.calls > 0 ? Math.round((m.connected / m.calls) * 1000) / 10 : null
        return {
          cells: [cleanPersonName(m.name) || tr('formerMember'), num(m.calls), num(m.connected), num(m.notConnected), att == null ? '—' : `${att}%`, ...open.map((_, i) => num(m.stages[i] ?? 0)), num(m.won)],
          colors: [null, null, null, m.notConnected > m.connected ? BAD : null, att == null ? MUTED : att >= 60 ? GOOD : att < 40 ? BAD : null, ...open.map(() => null), DARK],
        }
      })
      const tot = (fn: (m: typeof team[number]) => number) => team.reduce((a, m) => a + fn(m), 0)
      rows.push({
        bold: true,
        cells: [tr('pTeamTotal'), num(tot((m) => m.calls)), num(tot((m) => m.connected)), num(tot((m) => m.notConnected)), pctText(tot((m) => m.connected), tot((m) => m.calls)), ...open.map((_, i) => num(tot((m) => m.stages[i] ?? 0))), num(tot((m) => m.won))],
      } as never)
      y = table(M, y, CW, cols, rows, 18)
      // calls against attended, per person
      y = heading(`${tr('pCalls')} · ${tr('pAttended')}`, M, y + 4, CW)
      const rowH = Math.min(22, (H - M - FOOT - y) / Math.max(1, team.length))
      const labelW = 150
      const barW = CW - labelW - 110
      const max = Math.max(1, ...team.map((m) => m.calls))
      tag('Figure', { alt: team.map((m) => `${cleanPersonName(m.name)} ${m.calls} / ${m.connected}`).join(', ') }, () => {
        artifact(() => {
          team.forEach((m, i) => {
            const by = y + i * rowH + 3
            doc.roundedRect(M + labelW, by, Math.max(2, (m.calls / max) * barW), rowH - 6, 3).fill(tint(brandHex, 0.6))
            doc.roundedRect(M + labelW, by, Math.max(m.connected ? 2 : 0, (m.connected / max) * barW), rowH - 6, 3).fill(BRAND)
          })
        })
      })
      team.forEach((m, i) => {
        const ty = y + i * rowH + rowH / 2 - 5
        line(doc, cleanPersonName(m.name) || tr('formerMember'), M, ty, { size: 8.5, color: INK, width: labelW - 8, align: start, shrinkTo: 6 })
        line(doc, `${num(m.connected)} / ${num(m.calls)}`, M + labelW + barW + 8, ty, { size: 8.5, bold: true, color: DARK, width: 100, align: 'left' })
      })
    }
  }

  // ════ 6. detail ════════════════════════════════════════════════════
  {
    let y = page(tr('lSecSpeed'), range)
    const half = (CW - 24) / 2
    const lx = rtl ? M + half + 24 : M
    const rx = rtl ? M : M + half + 24
    let ly = y
    const sp = speed?.countedSince ? speed.rows : []
    if (sp.some((r) => r.leads > 0)) {
      ly = hBars(lx, ly, half, sp.map((r) => ({
        label: tr(SPEED_KEY[r.bucket]), value: r.leads,
        right: `${num(r.leads)} · ${r.winRate == null ? (r.leads ? tr('lTooFew') : '—') : `${r.winRate}%`}`,
        color: r.bucket === 'min5' ? GOOD : r.bucket === 'none' ? BAD : BRAND,
      })), 20)
      if (data.speedFinding) {
        tag('P', {}, () => { ly = paragraph(doc, clean(data.speedFinding, 240), lx, ly + 4, half, { size: 9, color: INK }) + 8 })
      }
    } else {
      ly = nothing(lx, ly, half)
    }
    ly = heading(tr('lSecLost'), lx, ly + 6, half)
    ly = s.lostReasons.length ? hBars(lx, ly, half, s.lostReasons.slice(0, 8).map((x) => ({ label: clean(x.reason, 50), value: x.count, right: num(x.count), color: BAD }))) : nothing(lx, ly, half)

    let ry = heading(tr('lSecPipeline'), rx, y, half)
    ry = s.pipelineByStage.length
      ? table(rx, ry, half, [
          { label: tr('lColPipeline'), frac: 0.3, align: 'left' }, { label: tr('lColStage'), frac: 0.3, align: 'left' },
          { label: tr('lColDeals'), frac: 0.15, align: 'center' }, { label: tr('colAmount'), frac: 0.25, align: 'right' },
        ], s.pipelineByStage.slice(0, 10).map((x) => ({ cells: [x.pipeline, x.stage, num(x.deals), formatAmount(x.amount, x.currency)] })))
      : nothing(rx, ry, half)
    ry = heading(tr('lSecCategory'), rx, ry + 6, half)
    ry = s.byCategory.length
      ? table(rx, ry, half, [
          { label: tr('colCategory'), frac: 0.5, align: 'left' }, { label: tr('lColDeals'), frac: 0.2, align: 'center' }, { label: tr('colAmount'), frac: 0.3, align: 'right' },
        ], s.byCategory.slice(0, 10).map((x) => ({ cells: [x.category, num(x.deals), formatAmount(x.amount, x.currency)] })))
      : nothing(rx, ry, half)
    const noteY = Math.max(ly, ry) + 8
    if (noteY < H - M - FOOT - 24) tag('P', {}, () => { paragraph(doc, tr('lNoteCredit'), M, noteY, CW, { size: 7.5, color: MUTED }) })
  }

  root.end()

  // ── footer on EVERY page ───────────────────────────────────────────
  const pages = doc.bufferedPageRange()
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p)
    const saved = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    d.markContent('Artifact', { type: 'Pagination' })
    doc.moveTo(M, H - 24).lineTo(W - M, H - 24).lineWidth(0.5).strokeColor(SOFT_LINE).stroke()
    line(doc, `${CRM_NAME}  ·  ${clean(name, 60)}  ·  ${range}`, M, H - 18, { size: 7.5, color: MUTED, width: CW - 90, align: start })
    line(doc, tr('pageOf', { n: p + 1, total: pages.count }), M, H - 18, { size: 7.5, color: MUTED, width: CW, align: end })
    d.endMarkedContent()
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
