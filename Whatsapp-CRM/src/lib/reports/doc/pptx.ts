/**
 * Any ReportDoc as slides (.pptx) with native charts and tables, so
 * PowerPoint can edit every number (docs/plans/reports-sections-plan.md).
 *
 *   - Cover: logo, business name, title, period, headline.
 *   - A slide of cards per figure block; a native chart per chart block
 *     (bar, line, bar + line combo on two axes, ranked rows, funnel); a
 *     native table per table block, split every MAX_ROWS rows with the
 *     title marked "(continued)"; slides of their own for text and findings.
 *   - The report's notes on a last slide.
 *
 * pptxgenjs rules kept from presentation-pptx.ts: hex colours never take a
 * "#"; a fresh options object for every call; the combo chart declares both
 * `valAxes` and `catAxes`; data labels never `outEnd` on a stacked series
 * (nothing here stacks); the zip is written again without folder entries.
 * Every string is cleaned and capped first.
 */
import PptxGenJS from 'pptxgenjs'
import { imageProblem } from '@/lib/files/image-size'
import { isRtlLanguage, t, type Key } from '../i18n'
import { withoutFolderEntries } from '../pptx/presentation-pptx'
import { fmtValue } from './pdf'
import { changeWords } from './change-words'
import { changeLabel, judgeChange } from './change'
import type { ChartBlock, Compared, DocBusiness, Finding, FindingsBlock, KpiBlock, KpiItem, ReportDoc, Series, TableBlock, TableCell, TextBlock, Tone } from './types'

export interface DocPptxInput {
  doc: ReportDoc
  business: DocBusiness
  language: string
  generatedAt: Date
}

const CRM_NAME = 'Lead Magnet CRM'
const DEFAULT_BRAND = '4338ca'
const INK = '1f2937'
const MUTED = '6b7280'
const LINE = 'e5e7eb'
const GOOD = '059669'
const BAD = 'b91c1c'
const AMBER = 'b45309'
const GOLD = 'b7791f'
const SERIES_COLORS = ['d97706', '0d9488', 'db2777', '64748b', '7c3aed']
const FONT = 'Calibri'
/** 13.33 × 7.5 in. */
const W = 13.333
const H = 7.5
const MX = 0.5
const CW = W - 2 * MX
const MAX_ROWS = 14
/** Rows of one table in the deck; the rest are in the Excel file (and it says so). */
const MAX_TABLE_ROWS = 140
const MAX_CHART_LABELS = 60
const MAX_TEXT_LINES = 9

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s : s == null ? '' : String(s))
  .slice(0, max * 4)
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max)
const num = (n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n))

function mix(hex: string, toward: number, amount: number): string {
  const h = /^[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRAND
  const m = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount) + toward * amount).toString(16).padStart(2, '0')
  return `${m(0)}${m(2)}${m(4)}`
}
const tint = (hex: string, a: number) => mix(hex, 255, a)
const shade = (hex: string, a: number) => mix(hex, 0, a)

function compareColor(c: Compared): string | null {
  if (c.small || c.now == null || c.before == null || c.now === c.before) return null
  return (c.now > c.before) === c.higherIsBetter ? GOOD : BAD
}

const SEVERITY: Record<Finding['severity'], { color: string; key: Key }> = {
  high: { color: BAD, key: 'dSevHigh' },
  medium: { color: AMBER, key: 'dSevMedium' },
  low: { color: '2563eb', key: 'dSevLow' },
  good: { color: GOOD, key: 'dSevGood' },
}

const toNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export async function docToPptx(input: DocPptxInput): Promise<Buffer> {
  const { doc: report, business, language, generatedAt } = input
  const tr = (key: Key, params?: Record<string, string | number>) => t(language, key, params)
  const rtl = isRtlLanguage(language)
  const align = rtl ? 'right' : 'left'
  const brand = /^[0-9a-f]{6}$/i.test(business.brandColor ?? '') ? (business.brandColor as string).toLowerCase() : DEFAULT_BRAND
  const soft = tint(brand, 0.9)
  const softLine = tint(brand, 0.75)
  const dark = shade(brand, 0.35)
  const name = clean(business.name, 80) || CRM_NAME
  const docTitle = clean(report.title, 120) || CRM_NAME
  const p = report.period
  const tz = clean(p?.timeZone, 60)
  const span = (a: unknown, b: unknown) => (clean(a, 20) === clean(b, 20) ? clean(a, 20) : `${clean(a, 20)} – ${clean(b, 20)}`)
  const range = span(p?.firstDay, p?.lastDay)
  const seriesColor = (i: number) => (i === 0 ? brand : SERIES_COLORS[(i - 1) % SERIES_COLORS.length])
  const toneColor = (tone: Tone | undefined): string | null =>
    tone === 'good' ? GOOD : tone === 'bad' ? BAD : tone === 'warn' ? AMBER : tone === 'brand' ? brand : tone === 'money' ? dark : null

  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_WIDE'
  pres.title = clean(`${name} · ${docTitle} · ${range}`, 200)
  pres.author = CRM_NAME
  pres.company = name
  if (rtl) pres.rtlMode = true

  const footer = clean(`${CRM_NAME}  |  ${name}  |  ${docTitle}  |  ${range}`, 180)
  pres.defineSlideMaster({
    title: 'CONTENT',
    background: { color: 'FFFFFF' },
    objects: [
      { line: { x: MX, y: H - 0.55, w: CW, h: 0, line: { color: softLine, width: 0.75 } } },
      { text: { text: footer, options: { x: MX, y: H - 0.45, w: CW - 1, h: 0.3, fontSize: 10, color: MUTED, fontFace: FONT, margin: 0, align, rtlMode: rtl } } },
    ],
    slideNumber: { x: W - MX - 0.6, y: H - 0.45, w: 0.6, h: 0.3, fontSize: 10, color: MUTED, fontFace: FONT, align: 'right' },
  })

  // ── logo, checked whole before PowerPoint sees it ─────────────────
  const logoProblem = business.logo ? imageProblem(business.logo.mime, business.logo.bytes) : null
  if (logoProblem) console.error('[doc-pptx] logo skipped:', logoProblem)
  const logo = business.logo && !logoProblem ? business.logo : null
  const logoData = logo ? `image/${logo.mime === 'image/png' ? 'png' : 'jpeg'};base64,${logo.bytes.toString('base64')}` : null
  const addLogo = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number) => {
    if (!logoData) return
    try {
      slide.addImage({ data: logoData, x, y, w, h, sizing: { type: 'contain', w, h } })
    } catch (err) {
      console.error('[doc-pptx] logo skipped:', err instanceof Error ? err.message : String(err))
    }
  }

  const text = (slide: PptxGenJS.Slide, str: string, o: PptxGenJS.TextPropsOptions) =>
    slide.addText(clean(str, 600), { fontFace: FONT, color: INK, margin: 0, isTextBox: true, align, rtlMode: rtl, ...o })

  const newSlide = (title: string, sub: string | null = null) => {
    const slide = pres.addSlide({ masterName: 'CONTENT' })
    text(slide, title, { x: MX, y: 0.4, w: CW - 2.2, h: 0.7, fontSize: 28, bold: true, color: dark, valign: 'top', fit: 'shrink' })
    if (sub) text(slide, sub, { x: MX, y: 1.1, w: CW - 2.2, h: 0.4, fontSize: 13, color: MUTED, valign: 'top', fit: 'shrink' })
    addLogo(slide, W - MX - 1.8, 0.35, 1.8, 0.9)
    return slide
  }
  const nothing = (slide: PptxGenJS.Slide, y = 1.8) => text(slide, tr('nothing'), { x: MX, y, w: CW, h: 0.4, fontSize: 14, color: MUTED })

  // ── cover ──────────────────────────────────────────────────────────
  {
    const slide = pres.addSlide({ masterName: 'CONTENT' })
    addLogo(slide, MX, 0.6, 2.4, 1.2)
    text(slide, name, { x: MX, y: 2.0, w: CW, h: 0.7, fontSize: 30, bold: true, color: dark, valign: 'middle', fit: 'shrink' })
    text(slide, docTitle, { x: MX, y: 2.7, w: CW, h: 0.7, fontSize: 26, color: INK, valign: 'middle', fit: 'shrink' })
    const periodLine = [`${tr('period')}: ${range}${p?.partial ? ` (${tr('dSoFar')})` : ''}`, tz, p?.previous ? tr('dCompared', { range: span(p.previous.firstDay, p.previous.lastDay) }) : null].filter(Boolean).join('  ·  ')
    text(slide, periodLine, { x: MX, y: 3.45, w: CW, h: 0.4, fontSize: 14, color: MUTED })
    const lines = (Array.isArray(business.lines) ? business.lines : []).map((l) => clean(l, 160)).filter(Boolean).slice(0, 2)
    if (business.taxId) lines.push(clean(tr('taxId', { id: clean(business.taxId, 40) }), 120))
    if (lines.length) text(slide, lines.join('   ·   '), { x: MX, y: 3.85, w: CW, h: 0.35, fontSize: 11, color: MUTED })
    const headline = clean(report.headline, 400)
    if (headline) {
      slide.addShape(pres.ShapeType.rect, { x: MX, y: 4.5, w: 0.08, h: 1.2, fill: { color: brand }, line: { color: brand, width: 0 } })
      text(slide, headline, { x: MX + 0.3, y: 4.5, w: CW - 0.3, h: 1.2, fontSize: 20, bold: true, color: INK, valign: 'middle', fit: 'shrink' })
    }
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(generatedAt).replace(',', '')
    text(slide, tr('generatedOn', { date: `${stamp} ${tz}` }), { x: MX, y: 6.3, w: CW, h: 0.3, fontSize: 10, color: MUTED })
  }

  // ── figure cards ───────────────────────────────────────────────────
  const card = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, it: KpiItem) => {
    const filled = it.tone === 'brand' ? brand : it.tone === 'money' ? GOLD : null
    slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: filled ?? soft }, line: { color: filled ?? softLine, width: 0.75 }, rectRadius: 0.08 })
    const value = clean(it.value, 40) || '—'
    const big = value.length > 12 ? 20 : value.length > 9 ? 24 : 28
    text(slide, value, { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.6, fontSize: big, bold: true, color: filled ? 'FFFFFF' : toneColor(it.tone) ?? INK, valign: 'middle', fit: 'shrink' })
    text(slide, clean(it.label, 60), { x: x + 0.15, y: y + 0.72, w: w - 0.3, h: 0.32, fontSize: 12.5, bold: true, color: filled ? 'FFFFFF' : dark, valign: 'top', fit: 'shrink' })
    const c = it.compare
    if (c && c.before != null) {
      // The shared rule (change.ts): too few, points, "N× before".
      const chg = judgeChange(c)
      const ch = changeLabel(chg, (v) => fmtValue(v, c.fmt, language), changeWords(language))
      const tone = chg.tone === 'good' ? GOOD : chg.tone === 'bad' ? BAD : null
      const col = filled ? 'FFFFFF' : chg.kind === 'small' ? 'a3a3a3' : tone ?? MUTED
      text(slide, `${tr('lBefore', { n: fmtValue(c.before, c.fmt, language) })}${ch ? ` · ${ch}` : ''}`, { x: x + 0.15, y: y + 1.04, w: w - 0.3, h: 0.3, fontSize: 10.5, bold: Boolean(tone), color: col, valign: 'top', fit: 'shrink' })
    } else if (it.sub) {
      text(slide, clean(it.sub, 80), { x: x + 0.15, y: y + 1.04, w: w - 0.3, h: 0.3, fontSize: 10.5, color: filled ? 'FFFFFF' : MUTED, valign: 'top', fit: 'shrink' })
    }
  }

  const kpis = (b: KpiBlock) => {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 72)
    if (!items.length) return
    const perSlide = 18
    for (let s = 0; s < items.length; s += perSlide) {
      const title = clean(b.title, 120) || docTitle
      const slide = newSlide(s ? tr('dContinued', { title }) : title)
      const chunk = items.slice(s, s + perSlide)
      const perRow = Math.min(6, chunk.length)
      const cw = (CW - (perRow - 1) * 0.2) / perRow
      chunk.forEach((it, i) => {
        const r = Math.floor(i / perRow)
        const col = rtl ? perRow - 1 - (i % perRow) : i % perRow
        card(slide, MX + col * (cw + 0.2), 1.7 + r * 1.6, cw, 1.4, it)
      })
    }
  }

  // ── charts ─────────────────────────────────────────────────────────
  const chartFrame = () => ({
    catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, dataLabelFontFace: FONT, legendFontFace: FONT,
    valGridLine: { color: LINE, size: 0.5 }, catGridLine: { style: 'none' as const },
    showLegend: true, legendPos: 'b' as const, legendFontSize: 10, legendColor: MUTED,
  })
  const valFormat = (s: Series | undefined) => (s?.fmt?.kind === 'percent' ? '0.0"%"' : s?.fmt?.kind === 'money' ? '#,##0' : '#,##0.##')

  const chart = (b: ChartBlock) => {
    const labels = (Array.isArray(b.labels) ? b.labels : []).slice(0, MAX_CHART_LABELS).map((l) => clean(l, 40))
    const series = (Array.isArray(b.series) ? b.series : []).slice(0, 6)
    const slide = newSlide(clean(b.title, 120) || docTitle, b.note ? clean(b.note, 200) : null)
    const empty = !labels.length || !series.length || series.every((s) => labels.every((_, i) => toNum(s.values?.[i]) === 0) && !(s.previous ?? []).some((v) => toNum(v) !== 0))
    if (empty) {
      nothing(slide)
      return
    }
    // One chart data entry per series, previous periods as faded series beside it.
    type Entry = { data: { name: string; labels: string[]; values: number[] }; color: string; src: Series }
    const entries = (list: Series[]): Entry[] => list.flatMap((s) => {
      const si = series.indexOf(s)
      const out: Entry[] = []
      if (Array.isArray(s.previous) && s.previous.length) out.push({ data: { name: clean(tr('dPrevSeries', { name: clean(s.name, 40) }), 60), labels: [...labels], values: labels.map((_, i) => toNum(s.previous?.[i])) }, color: tint(seriesColor(si), 0.6), src: s })
      out.push({ data: { name: clean(s.name, 60) || '—', labels: [...labels], values: labels.map((_, i) => toNum(s.values?.[i])) }, color: seriesColor(si), src: s })
      return out
    })
    const box = { x: MX, y: 1.7, w: CW, h: H - 1.7 - 0.7 }

    if (b.chart === 'barline') {
      const isLine = (s: Series) => s.kind === 'line' || (s.kind == null && s.axis === 'right')
      const bars = entries(series.filter((s) => !isLine(s)))
      const lines = entries(series.filter(isLine))
      const right = series.some((s) => isLine(s) && s.axis === 'right')
      if (bars.length && lines.length) {
        slide.addChart(
          [
            { type: pres.ChartType.bar, data: bars.map((e) => e.data), options: { barDir: 'col', barGapWidthPct: 60, chartColors: bars.map((e) => e.color) } },
            { type: pres.ChartType.line, data: lines.map((e) => e.data), options: { chartColors: lines.map((e) => e.color), lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 7, secondaryValAxis: right, secondaryCatAxis: right } },
          ],
          {
            ...box, ...chartFrame(),
            valAxes: right
              ? [{ showValAxisTitle: false, valAxisLabelColor: MUTED, valAxisLabelFontSize: 10, valAxisLabelFormatCode: valFormat(bars[0]?.src) }, { showValAxisTitle: false, valAxisLabelColor: lines[lines.length - 1].color, valAxisLabelFontSize: 10, valAxisLabelFormatCode: valFormat(lines[0]?.src), valGridLine: { style: 'none' } }]
              : [{ showValAxisTitle: false, valAxisLabelColor: MUTED, valAxisLabelFontSize: 10, valAxisLabelFormatCode: valFormat(bars[0]?.src) }],
            catAxes: right ? [{ catAxisLabelColor: MUTED, catAxisLabelFontSize: 10 }, { catAxisHidden: true }] : [{ catAxisLabelColor: MUTED, catAxisLabelFontSize: 10 }],
            // A combo chart takes its options second; pptxgenjs's typing calls that slot data.
          } as unknown as unknown[],
        )
        return
      }
      // Only one kind present: an ordinary chart of that kind.
      const only = bars.length ? bars : lines
      slide.addChart(bars.length ? pres.ChartType.bar : pres.ChartType.line, only.map((e) => e.data), {
        ...box, ...chartFrame(), chartColors: only.map((e) => e.color), barDir: 'col', barGapWidthPct: 60, lineSize: 2.5, valAxisLabelFormatCode: valFormat(series[0]),
      })
      return
    }

    const all = entries(series)
    if (b.chart === 'line') {
      slide.addChart(pres.ChartType.line, all.map((e) => e.data), {
        ...box, ...chartFrame(), chartColors: all.map((e) => e.color), lineSize: 2.5, lineDataSymbol: labels.length > 40 ? 'none' : 'circle', lineDataSymbolSize: 6, valAxisLabelFormatCode: valFormat(series[0]),
      })
      return
    }
    if (b.chart === 'bar') {
      slide.addChart(pres.ChartType.bar, all.map((e) => e.data), {
        ...box, ...chartFrame(), chartColors: all.map((e) => e.color), barDir: 'col', barGapWidthPct: 60, valAxisLabelFormatCode: valFormat(series[0]),
        showValue: labels.length * all.length <= 24, dataLabelPosition: 'outEnd', dataLabelColor: dark, dataLabelFontSize: 9, dataLabelFormatCode: valFormat(series[0]),
        showLegend: all.length > 1,
      })
      return
    }
    // hbar and funnel: horizontal bars, first label at the top.
    const funnel = b.chart === 'funnel'
    const data = funnel ? all.filter((e) => e.src === series[0]).slice(-1) : all
    slide.addChart(pres.ChartType.bar, data.map((e) => e.data), {
      ...box, ...chartFrame(), barDir: 'bar', barGapWidthPct: funnel ? 25 : 50,
      chartColors: funnel ? labels.map((_, i) => tint(brand, Math.min(0.6, i * 0.09))) : data.map((e) => e.color),
      showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: dark, dataLabelFontSize: 10, dataLabelFormatCode: valFormat(series[0]), valAxisLabelFormatCode: valFormat(series[0]),
      showLegend: !funnel && data.length > 1,
      valAxisHidden: funnel,
      ...({ catAxisOrientation: 'maxMin' } as Record<string, unknown>),
    })
  }

  // ── tables ─────────────────────────────────────────────────────────
  const table = (b: TableBlock) => {
    const cols = (Array.isArray(b.columns) ? b.columns : []).slice(0, 16)
    const title = clean(b.title, 120) || docTitle
    if (!cols.length) return
    const allRows = Array.isArray(b.rows) ? b.rows : []
    const rows = allRows.slice(0, MAX_TABLE_ROWS)
    const weights = cols.map((c) => (Number.isFinite(c.width) && (c.width as number) > 0 ? Math.min(10, c.width as number) : 1))
    const sum = weights.reduce((a, v) => a + v, 0)
    const colW = weights.map((w) => (CW * w) / sum)
    const order = cols.map((_, i) => i)
    if (rtl) order.reverse()
    const fontSize = cols.length > 10 ? 8 : cols.length > 7 ? 9.5 : 11
    const alignOf = (ci: number): 'left' | 'right' | 'center' => cols[ci].align ?? (cols[ci].fmt && cols[ci].fmt?.kind !== 'text' ? 'right' : align)
    const head = (): PptxGenJS.TableRow => order.map((ci) => ({ text: clean(cols[ci].label, 40), options: { bold: true, color: 'FFFFFF', fill: { color: dark }, align: alignOf(ci) } }))
    const bodyRow = (cells: TableCell[], i: number, total: boolean): PptxGenJS.TableRow => order.map((ci) => {
      const cell = cells[ci]
      return {
        text: clean(cell?.text ?? '', 120),
        options: { fill: { color: total ? softLine : i % 2 ? soft : 'FFFFFF' }, bold: total, align: alignOf(ci), color: toneColor(cell?.tone) ?? INK },
      }
    })
    const parts = Math.max(1, Math.ceil(rows.length / MAX_ROWS))
    for (let part = 0; part < parts; part++) {
      const slide = newSlide(part ? tr('dContinued', { title }) : title, part === 0 && b.note ? clean(b.note, 200) : null)
      if (!rows.length) {
        nothing(slide)
        continue
      }
      const chunk = rows.slice(part * MAX_ROWS, part * MAX_ROWS + MAX_ROWS)
      const body = chunk.map((r, i) => bodyRow(Array.isArray(r) ? r : [], part * MAX_ROWS + i, false))
      const last = part === parts - 1
      if (last && Array.isArray(b.total)) body.push(bodyRow(b.total, 0, true))
      slide.addTable([head(), ...body], {
        x: MX, y: 1.6, w: CW, colW: order.map((ci) => colW[ci]),
        fontFace: FONT, fontSize, color: INK, rowH: 0.3, border: { type: 'solid', pt: 0.5, color: LINE }, valign: 'middle', margin: 0.04,
      })
      if (last && allRows.length > rows.length) text(slide, tr('dMoreRows', { n: num(allRows.length - rows.length) }), { x: MX, y: H - 0.95, w: CW, h: 0.3, fontSize: 10, color: MUTED })
    }
  }

  // ── text ───────────────────────────────────────────────────────────
  const textBlock = (b: TextBlock) => {
    const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => clean(l, 600)).filter(Boolean).slice(0, 90)
    if (!lines.length) return
    const style = b.style ?? 'bullets'
    const title = clean(b.title, 120) || docTitle
    const per = style === 'headline' ? 3 : MAX_TEXT_LINES
    for (let s = 0; s < lines.length; s += per) {
      const slide = newSlide(s ? tr('dContinued', { title }) : title)
      const chunk = lines.slice(s, s + per)
      const y = 1.7
      const h = H - y - 0.8
      if (style === 'warning') {
        slide.addShape(pres.ShapeType.rect, { x: MX, y, w: 0.08, h, fill: { color: AMBER }, line: { color: AMBER, width: 0 } })
      }
      const runs: PptxGenJS.TextProps[] = chunk.map((l, i) => ({
        text: l,
        options: {
          breakLine: i < chunk.length - 1,
          bullet: style === 'bullets' ? { indent: 18 } : false,
          fontSize: style === 'headline' ? 26 : style === 'note' ? 13 : 16,
          bold: style === 'headline' || style === 'warning',
          color: style === 'headline' ? dark : style === 'note' ? MUTED : style === 'warning' ? AMBER : INK,
          paraSpaceAfter: 8,
        },
      }))
      slide.addText(runs, { x: style === 'warning' ? MX + 0.3 : MX, y, w: style === 'warning' ? CW - 0.3 : CW, h, fontFace: FONT, valign: 'top', margin: 0, isTextBox: true, align, rtlMode: rtl, fit: 'shrink' })
    }
  }

  // ── findings: four cards a slide, severity colour plus its word ───
  const findings = (b: FindingsBlock) => {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40)
    if (!items.length) return
    const title = clean(b.title, 120) || tr('pFindings')
    for (let s = 0; s < items.length; s += 4) {
      const slide = newSlide(s ? tr('dContinued', { title }) : title)
      const chunk = items.slice(s, s + 4)
      const cw = (CW - 0.3) / 2
      const ch = 2.4
      chunk.forEach((f, i) => {
        const sev = SEVERITY[f.severity] ?? SEVERITY.low
        const col = rtl ? 1 - (i % 2) : i % 2
        const x = MX + col * (cw + 0.3)
        const y = 1.7 + Math.floor(i / 2) * (ch + 0.25)
        slide.addShape(pres.ShapeType.rect, { x, y, w: cw, h: ch, fill: { color: soft }, line: { color: softLine, width: 0.75 } })
        slide.addShape(pres.ShapeType.rect, { x: rtl ? x + cw - 0.1 : x, y, w: 0.1, h: ch, fill: { color: sev.color }, line: { color: sev.color, width: 0 } })
        const ix = rtl ? x + 0.15 : x + 0.25
        const iw = cw - 0.4
        text(slide, tr(sev.key).toUpperCase(), { x: ix, y: y + 0.12, w: iw / 2, h: 0.25, fontSize: 10, bold: true, color: sev.color })
        if (f.byAi) text(slide, tr('dByAi'), { x: ix + iw / 2, y: y + 0.12, w: iw / 2, h: 0.25, fontSize: 10, bold: true, color: MUTED, align: rtl ? 'left' : 'right' })
        text(slide, clean(f.title, 160), { x: ix, y: y + 0.4, w: iw, h: 0.45, fontSize: 15, bold: true, color: INK, valign: 'top', fit: 'shrink' })
        text(slide, clean(f.evidence, 400), { x: ix, y: y + 0.88, w: iw, h: 0.75, fontSize: 11.5, color: INK, valign: 'top', fit: 'shrink' })
        if (f.suggestion) text(slide, tr('dSuggestion', { text: clean(f.suggestion, 300) }), { x: ix, y: y + 1.65, w: iw, h: 0.65, fontSize: 11.5, color: dark, valign: 'top', fit: 'shrink' })
      })
    }
  }

  const blocks = Array.isArray(report.blocks) ? report.blocks : []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b.kind === 'kpis') kpis(b)
    else if (b.kind === 'chart') chart(b)
    else if (b.kind === 'table') table(b)
    else if (b.kind === 'text') textBlock(b)
    else if (b.kind === 'findings') findings(b)
  }

  const notes = (Array.isArray(report.notes) ? report.notes : []).map((n) => clean(n, 400)).filter(Boolean).slice(0, 12)
  if (notes.length) textBlock({ kind: 'text', id: 'notes', title: tr('dNotes'), lines: notes, style: 'note' })

  const out = await pres.write({ outputType: 'nodebuffer' })
  return withoutFolderEntries(Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer))
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}
