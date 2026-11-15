/**
 * Any ReportDoc as a landscape A4 PDF, drawn in vectors so it stays sharp
 * when printed or zoomed (docs/plans/reports-sections-plan.md).
 *
 *   - First page: logo, business name, address lines and tax id, then the
 *     report's title, headline and period (and the period it is compared with).
 *   - Then every block in order, in the business's colour: figure cards,
 *     charts (bar, line, bar + line on two axes, ranked rows, funnel), tables
 *     (header repeated on a continuation page, bold total row), text and
 *     findings. A block that does not fit starts a new page.
 *   - The report's notes last; the CRM's name and "Page X of Y" on every page.
 *
 * Lessons kept from report-pdf.ts (copied, not imported): every string is
 * cleaned and capped, and arrows the fonts cannot draw (→ ▲ ▼) become
 * characters they can; axis tops step 1/2/5; amounts shrink to fit instead
 * of being cut; the logo is checked whole before pdfkit sees it; the build
 * has a time limit. Colour never carries meaning alone: a change has its
 * sign and a finding has its severity word.
 */
import PDFDocument from 'pdfkit'
import { formatAmount } from '@/lib/format/money'
import { imageProblem } from '@/lib/files/image-size'
import { isRtlLanguage, t, type Key } from '../i18n'
import { line, paragraph } from '../pdf/text'
import { pdfkitProblem } from '../pdf/logo-check'
import type { Block, ChartBlock, Compared, DocBusiness, FindingsBlock, Fmt, KpiBlock, KpiItem, ReportDoc, Series, TableBlock, TableCell, TextBlock, Tone } from './types'

export interface DocExportInput {
  doc: ReportDoc
  business: DocBusiness
  language: string
  generatedAt: Date
}

const CRM_NAME = 'Lead Magnet CRM'
/** A4 landscape. */
const W = 841.89
const H = 595.28
const M = 36
const CW = W - 2 * M
/** Nothing is drawn below this; the footer sits under it. */
const BOTTOM = H - 40
const PDF_TIMEOUT_MS = 30_000
const DEFAULT_BRAND = '4338ca'
/** Rows of one table in the PDF; the rest are in the Excel file (and it says so). */
const MAX_TABLE_ROWS = 600
/** Labels on one chart; a longer series is cut (the Excel file has them all). */
const MAX_CHART_LABELS = 60
const MAX_HBAR_ROWS = 40

const INK = '#1f2937'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const GRID = '#e5e7eb'
const GOOD = '#059669'
const BAD = '#b91c1c'
const AMBER = '#b45309'
const GOLD = '#b7791f'
/** Second and later series: distinct from the brand colour and from each other. */
const SERIES_COLORS = ['#d97706', '#0d9488', '#db2777', '#64748b', '#7c3aed']

const num = (n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n))

/**
 * Cleaned and capped. Arrows the PDF fonts cannot draw (→ ▲ ▼, also inside
 * translated text) become characters they can. Bounded before any pattern runs.
 */
export const clean = (s: unknown, max: number) => (typeof s === 'string' ? s : s == null ? '' : String(s))
  .slice(0, max * 4)
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/ ?→ ?/g, ' › ')
  .replace(/▲\s*/g, '+')
  .replace(/▼\s*/g, '-')
  .replace(/\s+/g, ' ').trim().slice(0, max)

function hexMix(hex: string, toward: number, amount: number): string {
  const h = /^[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRAND
  const mix = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount) + toward * amount).toString(16).padStart(2, '0')
  return `#${mix(0)}${mix(2)}${mix(4)}`
}
const tint = (hex: string, a: number) => hexMix(hex.replace('#', ''), 255, a)
const shade = (hex: string, a: number) => hexMix(hex.replace('#', ''), 0, a)

/** A round axis top with four equal steps of 1, 2 or 5 × 10ⁿ. Pure. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 4
  const raw = v / 4
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return Math.max(4, m * p * 4)
  return Math.max(4, 40 * p)
}

/** "+35%" / "-5%" / "0%"; null without a before. Plain signs: the fonts lack ▲ ▼. */
export function changeText(now: number | null, before: number | null): string | null {
  if (now == null || before == null || !(before > 0) || !Number.isFinite(now)) return null
  const c = Math.round(((now - before) / before) * 100)
  return c === 0 ? '0%' : `${c > 0 ? '+' : '-'}${Math.abs(c)}%`
}

/** A number as a Fmt says. Percent values are already 0–100. */
export function fmtValue(v: number | null | undefined, fmt: Fmt | undefined, lang: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  switch (fmt?.kind) {
    case 'money': return formatAmount(v, fmt.currency)
    case 'percent': return `${Number(v.toFixed(fmt.digits ?? 1))}%`
    case 'minutes': return t(lang, 'lMinutes', { n: num(v) })
    case 'text': return String(v)
    default: return Number.isInteger(v) ? num(v) : String(Math.round(v * 100) / 100)
  }
}

/** Short axis numbers: no ".00" on round amounts. */
function axisValue(v: number, fmt: Fmt | undefined, lang: string): string {
  if (fmt?.kind === 'money') return formatAmount(v, fmt.currency).replace(/\.0+$/, '')
  if (fmt?.kind === 'percent') return `${Math.round(v * 10) / 10}%`
  if (fmt?.kind === 'minutes') return t(lang, 'lMinutes', { n: num(v) })
  return Math.abs(v) >= 1 || v === 0 ? num(v) : String(Math.round(v * 100) / 100)
}

/** Good / bad colour of a change; none when too few to judge or unchanged. */
function compareColor(c: Compared): string | null {
  if (c.small || c.now == null || c.before == null || c.now === c.before) return null
  return (c.now > c.before) === c.higherIsBetter ? GOOD : BAD
}

type Struct = { add(c: unknown): void; end(): void }
type Tagged = {
  struct(type: string, opts?: Record<string, unknown>, fn?: () => void): Struct
  addStructure(el: unknown): void
  markContent(tag: string, opts?: Record<string, unknown>): void
  endMarkedContent(): void
}

const SEVERITY: Record<'high' | 'medium' | 'low' | 'good', { color: string; key: Key }> = {
  high: { color: BAD, key: 'dSevHigh' },
  medium: { color: AMBER, key: 'dSevMedium' },
  low: { color: '#2563eb', key: 'dSevLow' },
  good: { color: GOOD, key: 'dSevGood' },
}

/** Rough height of a wrapped paragraph, generous so a page break comes early rather than late. */
const estimateHeight = (text: string, width: number, size: number, leading = 1.4) =>
  Math.max(1, Math.ceil((Array.from(text).length * size * 0.58) / Math.max(20, width))) * size * leading

export async function docToPdf(input: DocExportInput): Promise<Buffer> {
  const { doc: report, business, language, generatedAt } = input
  const started = Date.now()
  const rtl = isRtlLanguage(language)
  const tr = (key: Key, params?: Record<string, string | number>) => t(language, key, params)
  const start = rtl ? 'right' : 'left'
  const end = rtl ? 'left' : 'right'
  const brandHex = /^[0-9a-f]{6}$/i.test(business.brandColor ?? '') ? (business.brandColor as string) : DEFAULT_BRAND
  const BRAND = `#${brandHex}`
  const DARK = shade(brandHex, 0.35)
  const SOFT = tint(brandHex, 0.92)
  const SOFT_LINE = tint(brandHex, 0.75)
  const name = clean(business.name, 120) || CRM_NAME
  const title = clean(report.title, 140)
  const p = report.period
  const tz = clean(p?.timeZone, 60)
  const span = (a: unknown, b: unknown) => (clean(a, 20) === clean(b, 20) ? clean(a, 20) : `${clean(a, 20)} – ${clean(b, 20)}`)
  const range = span(p?.firstDay, p?.lastDay)
  const seriesColor = (i: number) => (i === 0 ? BRAND : SERIES_COLORS[(i - 1) % SERIES_COLORS.length])
  const toneColor = (tone: Tone | undefined): string | null =>
    tone === 'good' ? GOOD : tone === 'bad' ? BAD : tone === 'warn' ? AMBER : tone === 'brand' ? BRAND : tone === 'money' ? DARK : null

  const pdf = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: M,
    bufferPages: true,
    tagged: true,
    displayTitle: true,
    lang: language === 'en' ? 'en-US' : language,
    pdfVersion: '1.7',
    ...({ subset: 'PDF/UA' } as Record<string, unknown>),
    info: { Title: `${title || CRM_NAME} · ${range}`, Author: name, Creator: CRM_NAME, Subject: title || CRM_NAME },
  })
  const chunks: Buffer[] = []
  pdf.on('data', (c: Buffer) => chunks.push(c))
  const finished = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
  })

  const d = pdf as unknown as Tagged
  const root = d.struct('Document')
  d.addStructure(root)
  const tag = (type: string, opts: Record<string, unknown>, fn: () => void) => root.add(d.struct(type, opts, fn))
  const artifact = (fn: () => void) => {
    d.markContent('Artifact', { type: 'Layout' })
    fn()
    d.endMarkedContent()
  }
  const P = (str: string, x: number, y: number, o: Parameters<typeof line>[4] = {}) =>
    tag('P', {}, () => line(pdf, clean(str, 400), x, y, { color: INK, align: start, ...o }))
  const para = (str: string, x: number, y: number, w: number, o: Parameters<typeof paragraph>[5] = {}): number => {
    let out = y
    tag('P', {}, () => { out = paragraph(pdf, clean(str, 1200), x, y, w, { color: INK, align: rtl ? 'right' : 'left', ...o }) })
    return out
  }

  // ── logo, checked whole before pdfkit sees it ──────────────────────
  const logoProblem = business.logo ? (imageProblem(business.logo.mime, business.logo.bytes) ?? pdfkitProblem(business.logo.bytes)) : null
  if (logoProblem) console.error('[doc-pdf] logo skipped:', logoProblem)
  const logo = business.logo && !logoProblem ? business.logo : null

  // ── page flow ──────────────────────────────────────────────────────
  let y = M
  const newPage = () => {
    if (Date.now() - started > PDF_TIMEOUT_MS) throw new Error('The PDF took too long to build.')
    pdf.addPage()
    // A running title, so a loose page still says what it belongs to.
    artifact(() => line(pdf, clean(`${title} · ${name}`, 160), M, M - 14, { size: 7.5, color: FAINT, width: CW, align: start }))
    y = M + 4
  }
  /** Room for `h` more points on this page, or a new page. */
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage()
  }
  /** A heading kept on the same page as the first `keep` points of what follows it. */
  const heading = (str: string | undefined, keep = 0) => {
    const s = clean(str, 140)
    if (!s) return
    ensure(24 + keep)
    tag('H2', {}, () => line(pdf, s, M, y, { size: 12, bold: true, color: INK, width: CW, align: start, shrinkTo: 8 }))
    y += 19
  }

  // ════ first page header ════════════════════════════════════════════
  {
    const logoW = logo ? 110 : 0
    if (logo) {
      tag('Figure', { alt: `${name} logo` }, () => {
        try {
          pdf.image(logo.bytes, rtl ? M : W - M - 100, M - 4, { fit: [100, 44] })
        } catch (err) {
          console.error('[doc-pdf] logo skipped:', err instanceof Error ? err.message : String(err))
        }
      })
    }
    const tx = rtl ? M + logoW : M
    const tw = CW - logoW
    tag('P', {}, () => line(pdf, name, tx, M, { size: 11, bold: true, color: DARK, width: tw, align: start, shrinkTo: 8 }))
    let hy = M + 15
    const headerLines = (Array.isArray(business.lines) ? business.lines : []).map((l) => clean(l, 160)).filter(Boolean).slice(0, 3)
    if (business.taxId) headerLines.push(clean(tr('taxId', { id: clean(business.taxId, 40) }), 120))
    for (const l of headerLines) {
      P(l, tx, hy, { size: 8, color: MUTED, width: tw, shrinkTo: 6 })
      hy += 11
    }
    y = Math.max(hy, M + 46) + 6
    artifact(() => pdf.moveTo(M, y).lineTo(W - M, y).lineWidth(1).strokeColor(SOFT_LINE).stroke())
    y += 12
    tag('H1', {}, () => line(pdf, title || CRM_NAME, M, y, { size: 22, bold: true, color: DARK, width: CW, align: start, shrinkTo: 14 }))
    y += 30
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(generatedAt).replace(',', '')
    const periodLine = [`${tr('period')}: ${range}${p?.partial ? ` (${tr('dSoFar')})` : ''}`, tz,
      p?.previous ? tr('dCompared', { range: span(p.previous.firstDay, p.previous.lastDay) }) : null,
      tr('generatedOn', { date: `${stamp} ${tz}` })].filter(Boolean).join('  ·  ')
    P(periodLine, M, y, { size: 9, color: MUTED, width: CW, shrinkTo: 6.5 })
    y += 16
    const headline = clean(report.headline, 400)
    if (headline) {
      y = para(headline, M, y + 2, CW, { size: 13, bold: true, color: INK, leading: 1.3 }) + 8
    }
    y += 4
  }

  // ════ blocks ═══════════════════════════════════════════════════════
  const kpis = (b: KpiBlock) => {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60)
    if (!items.length) return
    heading(b.title, 78)
    const perRow = Math.min(6, items.length)
    const gap = 10
    const cw = (CW - (perRow - 1) * gap) / perRow
    const ch = 68
    for (let r = 0; r < items.length; r += perRow) {
      ensure(ch + 12)
      const row = items.slice(r, r + perRow)
      row.forEach((it, i) => {
        const col = rtl ? perRow - 1 - i : i
        card(it, M + col * (cw + gap), y, cw, ch)
      })
      y += ch + 10
    }
    y += 6
  }

  const card = (it: KpiItem, x: number, cy: number, w: number, h: number) => {
    const filled = it.tone === 'brand' ? BRAND : it.tone === 'money' ? GOLD : null
    artifact(() => pdf.roundedRect(x, cy, w, h, 7).fillAndStroke(filled ?? SOFT, filled ?? SOFT_LINE))
    const valueColor = filled ? '#ffffff' : toneColor(it.tone) ?? INK
    tag('P', {}, () => {
      line(pdf, clean(it.value, 60) || '—', x + 10, cy + 9, { size: 17, bold: true, color: valueColor, width: w - 20, align: start, shrinkTo: 8 })
      line(pdf, clean(it.label, 80), x + 10, cy + 33, { size: 9, bold: true, color: filled ? '#ffffff' : DARK, width: w - 20, align: start, shrinkTo: 6.5 })
      const c = it.compare
      if (c && c.before != null) {
        const ch = changeText(c.now, c.before)
        const txt = `${tr('lBefore', { n: fmtValue(c.before, c.fmt, language) })}${ch ? ` · ${ch}` : ''}`
        const col = filled ? '#ffffff' : c.small ? FAINT : compareColor(c) ?? MUTED
        line(pdf, clean(txt, 80), x + 10, cy + 48, { size: 7.8, bold: Boolean(!c.small && compareColor(c)), color: col, width: w - 20, align: start, shrinkTo: 5.5 })
      } else if (it.sub) {
        line(pdf, clean(it.sub, 80), x + 10, cy + 48, { size: 7.8, color: filled ? '#ffffff' : MUTED, width: w - 20, align: start, shrinkTo: 5.5 })
      }
    })
  }

  // ── charts ─────────────────────────────────────────────────────────
  const legend = (series: Series[], lx: number, ly: number, lw: number, lineIdx: (s: Series) => boolean, barTint = 0) => {
    const entries: Array<{ label: string; color: string; asLine: boolean; faded: boolean }> = []
    series.forEach((s, i) => {
      const asLine = lineIdx(s)
      entries.push({ label: clean(s.name, 40), color: asLine || !barTint ? seriesColor(i) : tint(seriesColor(i), barTint), asLine, faded: false })
      if (s.previous?.length) entries.push({ label: clean(tr('dPrevSeries', { name: clean(s.name, 30) }), 50), color: seriesColor(i), asLine, faded: true })
    })
    let cx = lx
    let cy = ly
    for (const e of entries) {
      const ew = Math.min(lw, 22 + e.label.length * 4.6)
      if (cx + ew > lx + lw) {
        cx = lx
        cy += 13
      }
      artifact(() => {
        if (e.asLine) {
          pdf.moveTo(cx, cy + 5).lineTo(cx + 14, cy + 5).lineWidth(2).strokeColor(e.faded ? tint(e.color, 0.45) : e.color)
          if (e.faded) pdf.dash(3, { space: 2 })
          pdf.stroke().undash()
        } else {
          pdf.rect(cx + 2, cy + 1, 9, 9).fill(e.faded ? tint(e.color, 0.65) : e.color)
        }
      })
      line(pdf, e.label, cx + 18, cy, { size: 8, color: MUTED, width: ew - 20 })
      cx += ew + 10
    }
    return cy + 14
  }

  /** Columns and lines over labels; lines with axis 'right' get a second axis. */
  const xyChart = (b: ChartBlock, labels: string[], series: Series[], cy: number, ch: number) => {
    const isLine = (s: Series) => b.chart === 'line' || (b.chart === 'barline' && (s.kind === 'line' || (s.kind == null && s.axis === 'right')))
    const onRight = (s: Series) => b.chart === 'barline' && s.axis === 'right'
    const hasRight = series.some(onRight)
    const left = series.filter((s) => !onRight(s))
    const right = series.filter(onRight)
    const vals = (list: Series[]) => list.flatMap((s) => [...s.values, ...(s.previous ?? [])]).filter((v) => Number.isFinite(v))
    const lMax = niceMax(Math.max(0, ...vals(left)))
    const rMax = niceMax(Math.max(0, ...vals(right)))
    const lFmt = left[0]?.fmt
    const rFmt = right[0]?.fmt
    const axisW = 52
    const plotX = M + axisW
    const plotW = CW - axisW * (hasRight ? 2 : 1)
    const plotH = ch - 40
    const n = Math.max(1, labels.length)
    const slot = plotW / n
    const bars = series.filter((s) => !isLine(s))
    const barSlots = bars.reduce((a, s) => a + (s.previous?.length ? 2 : 1), 0)
    const groupW = Math.min(slot * 0.72, Math.max(1, barSlots) * 26)
    const bw = barSlots ? groupW / barSlots : 0
    const yOf = (v: number, max: number) => cy + plotH - (Math.max(0, Number.isFinite(v) ? v : 0) / max) * plotH
    const alt = clean(b.alt, 600) || clean(`${b.title}: ${series.map((s) => `${s.name} ${labels.slice(0, 20).map((l, i) => `${l} ${fmtValue(s.values[i], s.fmt, language)}`).join(', ')}`).join('; ')}`, 600)
    tag('Figure', { alt }, () => {
      artifact(() => {
        for (let g = 0; g <= 4; g++) {
          const gy = cy + plotH - (plotH * g) / 4
          pdf.moveTo(plotX, gy).lineTo(plotX + plotW, gy).lineWidth(0.5).strokeColor(GRID).stroke()
        }
        // bars: previous (faded) then current, side by side in each slot
        let bi = 0
        series.forEach((s, si) => {
          if (isLine(s)) return
          const max = onRight(s) ? rMax : lMax
          const color = seriesColor(si)
          const draw = (v: number[], k: number, fill: string) => v.slice(0, n).forEach((val, i) => {
            const top = yOf(val, max)
            const h = cy + plotH - top
            if (h > 0) pdf.rect(plotX + i * slot + (slot - groupW) / 2 + k * bw + 0.5, top, Math.max(1, bw - 1), h).fill(fill)
          })
          if (s.previous?.length) draw(s.previous, bi++, tint(color, 0.65))
          draw(s.values, bi++, b.chart === 'barline' ? tint(color, 0.35) : color)
        })
        // lines: previous dashed and faded, current solid with dots
        series.forEach((s, si) => {
          if (!isLine(s)) return
          const max = onRight(s) ? rMax : lMax
          const color = seriesColor(si)
          const path = (v: number[], faded: boolean) => {
            const pts = v.slice(0, n).map((val, i) => [plotX + i * slot + slot / 2, yOf(val, max)] as const)
            if (!pts.length) return
            pts.forEach(([px, py], i) => (i === 0 ? pdf.moveTo(px, py) : pdf.lineTo(px, py)))
            if (pts.length > 1) {
              pdf.lineWidth(faded ? 1.4 : 2.2).strokeColor(faded ? tint(color, 0.45) : color)
              if (faded) pdf.dash(4, { space: 3 })
              pdf.stroke().undash()
            }
            if (!faded && n <= 40) pts.forEach(([px, py]) => pdf.circle(px, py, 2.8).fillAndStroke(color, '#ffffff'))
          }
          if (s.previous?.length) path(s.previous, true)
          path(s.values, false)
        })
      })
    })
    // Axis numbers and labels are text, so a reader can select them.
    for (let g = 0; g <= 4; g++) {
      const gy = cy + plotH - (plotH * g) / 4 - 4
      if (left.length) line(pdf, axisValue((lMax * g) / 4, lFmt, language), M, gy, { size: 7, color: MUTED, width: axisW - 6, align: 'right', shrinkTo: 5 })
      if (hasRight) line(pdf, axisValue((rMax * g) / 4, rFmt, language), plotX + plotW + 6, gy, { size: 7, color: seriesColor(series.indexOf(right[0])), width: axisW - 6, align: 'left', shrinkTo: 5 })
    }
    const every = Math.ceil(n / 16)
    labels.forEach((l, i) => {
      if (i % every) return
      line(pdf, clean(l, 16), plotX + i * slot, cy + plotH + 5, { size: 7, color: MUTED, width: slot * every, align: 'center', shrinkTo: 5.5 })
    })
    return legend(series, plotX, cy + plotH + 20, plotW, isLine, b.chart === 'barline' ? 0.35 : 0)
  }

  /** Ranked rows: a label, one bar per series (previous faded beneath), the value. */
  const hbarChart = (b: ChartBlock, labels: string[], series: Series[]) => {
    const labelW = Math.min(200, CW * 0.28)
    const rightW = 110
    const barW = CW - labelW - rightW - 16
    const nBars = series.reduce((a, s) => a + (s.previous?.length ? 2 : 1), 0) || 1
    const rowH = Math.max(18, 6 + nBars * 8)
    const max = Math.max(1, ...series.flatMap((s) => [...s.values, ...(s.previous ?? [])]).filter((v) => Number.isFinite(v)))
    let i = 0
    while (i < labels.length) {
      ensure(rowH * 2)
      const fit = Math.max(1, Math.floor((BOTTOM - y) / rowH))
      const chunk = labels.slice(i, i + fit)
      const top = y
      tag('Figure', { alt: clean(chunk.map((l, k) => `${l} ${fmtValue(series[0]?.values[i + k], series[0]?.fmt, language)}`).join(', '), 600) }, () => {
        artifact(() => {
          chunk.forEach((_, k) => {
            let by = top + k * rowH + 4
            const bh = (rowH - 8) / nBars
            series.forEach((s, si) => {
              const color = seriesColor(si)
              const bar = (v: number | undefined, fill: string) => {
                const val = Number.isFinite(v) ? Math.max(0, v as number) : 0
                const w2 = Math.max(val > 0 ? 2 : 0, (val / max) * barW)
                if (w2 > 0) pdf.roundedRect(M + labelW + 8, by, w2, Math.max(2, bh - 1), 2).fill(fill)
                by += bh
              }
              if (s.previous?.length) bar(s.previous[i + k], tint(color, 0.65))
              bar(s.values[i + k], color)
            })
          })
        })
      })
      chunk.forEach((l, k) => {
        const ty = top + k * rowH + rowH / 2 - 5
        line(pdf, clean(l, 60), M, ty, { size: 8.5, color: INK, width: labelW, align: start, shrinkTo: 6.5 })
        const s0 = series[0]
        const prev = s0?.previous?.[i + k]
        const right = `${fmtValue(s0?.values[i + k], s0?.fmt, language)}${prev != null ? ` (${fmtValue(prev, s0?.fmt, language)})` : ''}`
        line(pdf, right, M + labelW + barW + 16, ty, { size: 8.5, bold: true, color: DARK, width: rightW, align: 'right', shrinkTo: 5.5 })
      })
      y = top + chunk.length * rowH + 4
      i += chunk.length
    }
    if (series.length > 1 || series.some((s) => s.previous?.length)) y = legend(series, M + labelW + 8, y + 2, barW, () => false)
    y += 4
  }

  /** A stepped funnel: each stage a centred bar, its count and the share of the first stage. */
  const funnelChart = (b: ChartBlock, labels: string[], series: Series[]) => {
    const s0 = series[0]
    if (!s0) return
    const vals = labels.map((_, i) => (Number.isFinite(s0.values[i]) ? Math.max(0, s0.values[i]) : 0))
    const first = vals[0] ?? 0
    const top = Math.max(1, ...vals)
    const labelW = 170
    const rightW = 120
    const area = CW - labelW - rightW - 20
    const stepH = 30
    let i = 0
    while (i < labels.length) {
      ensure(stepH * 2)
      const fit = Math.max(1, Math.floor((BOTTOM - y) / stepH))
      const chunk = labels.slice(i, i + fit)
      const y0 = y
      tag('Figure', { alt: clean(b.alt, 600) || clean(chunk.map((l, k) => `${l} ${fmtValue(vals[i + k], s0.fmt, language)}`).join(', '), 600) }, () => {
        artifact(() => chunk.forEach((_, k) => {
          const bw = Math.max(36, (vals[i + k] / top) * area)
          pdf.roundedRect(M + labelW + 10 + (area - bw) / 2, y0 + k * stepH + 3, bw, stepH - 6, 4).fill(tint(brandHex, Math.min(0.6, (i + k) * 0.09)))
        }))
      })
      chunk.forEach((l, k) => {
        const v = vals[i + k]
        const sy = y0 + k * stepH + stepH / 2 - 5
        const light = (i + k) * 0.09 > 0.4
        line(pdf, clean(l, 50), M, sy, { size: 9, color: INK, width: labelW, align: start, shrinkTo: 6.5 })
        const share = first > 0 ? ` · ${Math.round((v / first) * 1000) / 10}%` : ''
        line(pdf, `${fmtValue(v, s0.fmt, language)}${share}`, M + labelW + 10, sy, { size: 8.5, bold: true, color: light ? DARK : '#ffffff', width: area, align: 'center', shrinkTo: 6 })
        const prev = s0.previous?.[i + k]
        if (prev != null) line(pdf, tr('lBefore', { n: fmtValue(prev, s0.fmt, language) }), M + labelW + area + 20, sy, { size: 8, color: MUTED, width: rightW, align: 'right', shrinkTo: 6 })
      })
      y = y0 + chunk.length * stepH + 4
      i += chunk.length
    }
    y += 6
  }

  const chart = (b: ChartBlock) => {
    const labels = (Array.isArray(b.labels) ? b.labels : []).slice(0, b.chart === 'hbar' || b.chart === 'funnel' ? MAX_HBAR_ROWS : MAX_CHART_LABELS).map((l) => clean(l, 60))
    const series = (Array.isArray(b.series) ? b.series : []).slice(0, 6).map((s) => ({
      ...s,
      values: labels.map((_, i) => toNum(s.values?.[i])),
      previous: Array.isArray(s.previous) && s.previous.length ? labels.map((_, i) => toNum(s.previous?.[i])) : undefined,
    }))
    const empty = !labels.length || !series.length || series.every((s) => s.values.every((v) => v === 0) && !(s.previous ?? []).some((v) => v !== 0))
    const xy = b.chart === 'bar' || b.chart === 'line' || b.chart === 'barline'
    // Keep a chart whole on one page when it can be: heading + plot + legend.
    const nBars = series.reduce((a, s) => a + (s.previous?.length ? 2 : 1), 0) || 1
    const rowsH = b.chart === 'funnel' ? labels.length * 30 + 10 : labels.length * Math.max(18, 6 + nBars * 8) + 30
    ensure(empty ? 50 : xy ? 220 : Math.min(rowsH + 24, BOTTOM - M - 30))
    heading(b.title)
    if (empty) {
      P(tr('nothing'), M, y, { size: 9, color: MUTED, width: CW })
      y += 18
    } else if (xy) {
      const ch = Math.min(240, Math.max(180, BOTTOM - y - 40))
      y = xyChart(b, labels, series, y + 8, ch) + 6
    } else if (b.chart === 'funnel') {
      funnelChart(b, labels, series)
    } else {
      hbarChart(b, labels, series)
    }
    if (b.note) {
      const note = clean(b.note, 400)
      ensure(estimateHeight(note, CW, 8) + 4)
      y = para(note, M, y, CW, { size: 8, color: MUTED }) + 6
    }
    y += 8
  }

  // ── tables ─────────────────────────────────────────────────────────
  const table = (b: TableBlock) => {
    const cols = (Array.isArray(b.columns) ? b.columns : []).slice(0, 24)
    if (!cols.length) return
    const allRows = Array.isArray(b.rows) ? b.rows : []
    const rows = allRows.slice(0, MAX_TABLE_ROWS)
    const rowH = cols.length > 12 ? 15 : 17
    const size = cols.length > 12 ? 7 : 8.2
    ensure(24 + rowH * Math.min(3, rows.length + 1))
    heading(b.title)
    const weights = cols.map((c) => (Number.isFinite(c.width) && (c.width as number) > 0 ? Math.min(10, c.width as number) : 1))
    const sum = weights.reduce((a, v) => a + v, 0)
    const order = cols.map((_, i) => i)
    if (rtl) order.reverse()
    const tbl = d.struct('Table')
    root.add(tbl)
    const drawRow = (cells: Array<TableCell | string>, ry: number, kind: 'head' | 'body' | 'total', band: number) => {
      artifact(() => pdf.rect(M, ry, CW, rowH).fill(kind === 'head' ? DARK : kind === 'total' ? SOFT_LINE : band % 2 ? SOFT : '#ffffff'))
      const tr2 = d.struct('TR')
      tbl.add(tr2)
      let cx = M
      for (const ci of order) {
        const cw = (CW * weights[ci]) / sum
        const x0 = cx
        const c = cols[ci]
        const cell = cells[ci]
        const txt = typeof cell === 'string' ? cell : cell?.text
        const color = kind === 'head' ? '#ffffff' : typeof cell === 'object' && cell ? toneColor(cell.tone) ?? INK : INK
        const align = c.align ?? (c.fmt && c.fmt.kind !== 'text' ? 'right' : start)
        const money = c.fmt?.kind === 'money' || (typeof cell === 'object' && cell?.tone === 'money')
        tr2.add(d.struct(kind === 'head' ? 'TH' : 'TD', kind === 'head' ? { scope: 'Column' } : {}, () =>
          line(pdf, clean(txt ?? '', 160), x0 + 5, ry + (rowH - size) / 2 - 1, { size, bold: kind !== 'body', color, width: cw - 10, align, shrinkTo: money ? 4.5 : 5.5 })))
        cx += cw
      }
      tr2.end()
    }
    const header = () => {
      drawRow(cols.map((c) => c.label), y, 'head', 0)
      y += rowH
    }
    header()
    if (!rows.length) {
      P(tr('nothing'), M + 5, y + 4, { size: 8.5, color: MUTED, width: CW - 10 })
      y += rowH
    }
    rows.forEach((r, i) => {
      if (y + rowH > BOTTOM) {
        newPage()
        tag('P', {}, () => line(pdf, clean(tr('dContinued', { title: clean(b.title, 100) }), 140), M, y, { size: 9, bold: true, color: MUTED, width: CW, align: start }))
        y += 15
        header()
      }
      drawRow(Array.isArray(r) ? r : [], y, 'body', i)
      y += rowH
    })
    if (b.total && Array.isArray(b.total)) {
      if (y + rowH > BOTTOM) {
        newPage()
        header()
      }
      drawRow(b.total, y, 'total', 0)
      y += rowH
    }
    tbl.end()
    y += 6
    const after = [allRows.length > rows.length ? tr('dMoreRows', { n: num(allRows.length - rows.length) }) : null, b.note ? clean(b.note, 400) : null].filter((x): x is string => Boolean(x))
    for (const n of after) {
      ensure(estimateHeight(n, CW, 8) + 4)
      y = para(n, M, y, CW, { size: 8, color: MUTED }) + 4
    }
    y += 10
  }

  // ── text ───────────────────────────────────────────────────────────
  const text = (b: TextBlock) => {
    const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => clean(l, 1200)).filter(Boolean).slice(0, 200)
    if (!lines.length) return
    heading(b.title, 30)
    const style = b.style ?? 'bullets'
    for (const l of lines) {
      if (style === 'headline') {
        ensure(estimateHeight(l, CW, 14, 1.3) + 6)
        y = para(l, M, y, CW, { size: 14, bold: true, color: DARK, leading: 1.3 }) + 6
      } else if (style === 'bullets') {
        const h = estimateHeight(l, CW - 14, 9.5)
        ensure(h + 4)
        artifact(() => pdf.circle(rtl ? W - M - 4 : M + 4, y + 6, 2.2).fill(BRAND))
        y = para(l, rtl ? M : M + 14, y, CW - 14, { size: 9.5 }) + 4
      } else if (style === 'note') {
        ensure(estimateHeight(l, CW, 8.5) + 4)
        y = para(l, M, y, CW, { size: 8.5, color: MUTED }) + 4
      } else {
        // warning: amber text with an amber bar beside it (drawn after, so nothing hides the text)
        ensure(estimateHeight(l, CW - 16, 9.5) + 6)
        const y0 = y
        y = para(l, rtl ? M : M + 12, y, CW - 16, { size: 9.5, bold: true, color: AMBER }) + 2
        artifact(() => pdf.rect(rtl ? W - M - 4 : M, y0 - 1, 4, y - y0).fill(AMBER))
        y += 4
      }
    }
    y += 8
  }

  // ── findings ───────────────────────────────────────────────────────
  const findings = (b: FindingsBlock) => {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40)
    if (!items.length) return
    heading(b.title ?? tr('pFindings'), 60)
    const tx = rtl ? M : M + 14
    const tw = CW - 14
    for (const f of items) {
      const sev = SEVERITY[f.severity] ?? SEVERITY.low
      const word = tr(sev.key)
      const ftitle = clean(f.title, 200)
      const evidence = clean(f.evidence, 800)
      const suggestion = clean(f.suggestion, 800)
      const need = 20 + estimateHeight(evidence, tw, 9) + (suggestion ? estimateHeight(tr('dSuggestion', { text: suggestion }), tw, 9) : 0) + 10
      ensure(Math.min(need, BOTTOM - M - 20))
      const y0 = y
      // Severity as a word in its colour, the title, and an AI label when written by AI.
      tag('P', {}, () => {
        const ww = line(pdf, word.toUpperCase(), rtl ? tx + tw - 110 : tx, y, { size: 7.5, bold: true, color: sev.color, width: 110, align: start })
        const aiW = f.byAi ? line(pdf, tr('dByAi'), tx, y, { size: 7.5, bold: true, color: MUTED, width: tw, align: end }) + 12 : 0
        line(pdf, ftitle, rtl ? tx + aiW : tx + ww + 10, y - 1.5, { size: 10.5, bold: true, color: INK, width: tw - ww - 10 - aiW, align: start, shrinkTo: 7 })
      })
      y += 16
      if (evidence) y = para(evidence, tx, y, tw, { size: 9, color: INK }) + 1
      if (suggestion) y = para(tr('dSuggestion', { text: suggestion }), tx, y, tw, { size: 9, color: DARK, bold: false }) + 1
      artifact(() => {
        pdf.roundedRect(rtl ? W - M - 5 : M, y0 - 2, 5, y - y0 + 2, 2).fill(sev.color)
        pdf.moveTo(tx, y + 4).lineTo(tx + tw, y + 4).lineWidth(0.5).strokeColor(GRID).stroke()
      })
      y += 12
    }
    y += 4
  }

  const blocks: Block[] = Array.isArray(report.blocks) ? report.blocks : []
  for (const b of blocks) {
    if (Date.now() - started > PDF_TIMEOUT_MS) throw new Error('The PDF took too long to build.')
    if (!b || typeof b !== 'object') continue
    if (b.kind === 'kpis') kpis(b)
    else if (b.kind === 'chart') chart(b)
    else if (b.kind === 'table') table(b)
    else if (b.kind === 'text') text(b)
    else if (b.kind === 'findings') findings(b)
  }

  // ── notes ──────────────────────────────────────────────────────────
  const notes = (Array.isArray(report.notes) ? report.notes : []).map((n) => clean(n, 600)).filter(Boolean).slice(0, 30)
  if (notes.length) {
    ensure(40)
    heading(tr('dNotes'), 16)
    for (const n of notes) {
      ensure(estimateHeight(n, CW, 8.5) + 4)
      y = para(n, M, y, CW, { size: 8.5, color: MUTED }) + 4
    }
  }

  root.end()

  // ── footer on EVERY page ───────────────────────────────────────────
  const pages = pdf.bufferedPageRange()
  for (let pg = pages.start; pg < pages.start + pages.count; pg++) {
    pdf.switchToPage(pg)
    const saved = pdf.page.margins.bottom
    pdf.page.margins.bottom = 0
    d.markContent('Artifact', { type: 'Pagination' })
    pdf.moveTo(M, H - 24).lineTo(W - M, H - 24).lineWidth(0.5).strokeColor(SOFT_LINE).stroke()
    line(pdf, `${CRM_NAME}  ·  ${clean(name, 60)}  ·  ${range}`, rtl ? M + 100 : M, H - 18, { size: 7.5, color: MUTED, width: CW - 100, align: start })
    line(pdf, tr('pageOf', { n: pg + 1, total: pages.count }), M, H - 18, { size: 7.5, color: MUTED, width: CW, align: end })
    d.endMarkedContent()
    pdf.page.margins.bottom = saved
  }
  pdf.end()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The PDF took too long to build.')), Math.max(1000, PDF_TIMEOUT_MS - (Date.now() - started)))
  })
  try {
    return await Promise.race([finished, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** A zone Intl accepts; a bad one would throw in the middle of the build. */
function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}
