/**
 * The owner's report as slides (.pptx), in the business's own colour and
 * language, with the charts native — PowerPoint can edit every number.
 *
 *   1. Cover: logo, business name, period, three headline figures.
 *   2. Ads at a glance: six figure cards and spend-against-conversations
 *      by day (a bar + line chart on two axes).
 *   3. Leads by category and day: the table and a share chart.
 *   4. Funnel and team: stage cards, the team table, conversion rates
 *      against the period before.
 *   5. What needs doing: counts only.
 *
 * Rules carried over from the PDFs: every label and cell cleaned and
 * capped; team names via cleanPersonName; no customer name or number;
 * the logo only after it was checked whole. pptxgenjs gotchas honoured:
 * hex colours without "#", a fresh options object per call, native
 * charts, both `valAxes` and `catAxes` on the combo chart, `isTextBox`
 * on every text, data labels never `outEnd` on a stacked series.
 */
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { cleanPersonName } from '@/lib/auth/person-name'
import { formatAmount } from '@/lib/format/money'
import { imageProblem } from '@/lib/files/image-size'
import { isRtlLanguage, t, type Key } from '../i18n'
import type { PresentationData } from '../presentation'
import type { PdfBusiness } from '../pdf/spending-pdf'

export interface DeckInput {
  data: PresentationData
  business: PdfBusiness
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
const GOLD = 'b7791f'
const FONT = 'Calibri'
/** 13.33 × 7.5 in. */
const W = 13.333
const H = 7.5
const MX = 0.5
const CW = W - 2 * MX
const MAX_ROWS = 14

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const num = (n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n))

/** Mix a hex colour with white: 0 = the colour, 1 = white. */
export function tint(hex: string, amount: number): string {
  const h = /^[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRAND
  const mix = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount) + 255 * amount).toString(16).padStart(2, '0')
  return `${mix(0)}${mix(2)}${mix(4)}`
}

/** Darken a hex colour: 0 = the colour, 1 = black. */
export function shade(hex: string, amount: number): string {
  const h = /^[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRAND
  const mix = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0')
  return `${mix(0)}${mix(2)}${mix(4)}`
}

/** "▲ 32%" / "▼ 5%" / null when there is nothing to compare with. Pure. */
export function changeText(now: number, before: number): { text: string; up: boolean } | null {
  if (!(before > 0)) return null
  const c = Math.round(((now - before) / before) * 100)
  if (c === 0) return { text: '± 0%', up: true }
  return { text: `${c > 0 ? '▲' : '▼'} ${Math.abs(c)}%`, up: c > 0 }
}

function dayLabel(day: string, language: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : language, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date)
  } catch {
    return `${d}/${m}`
  }
}

function weekdayShort(day: string, language: string): string {
  const [y, m, d] = day.split('-').map(Number)
  try {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  } catch {
    return ''
  }
}

export async function buildDeck(input: DeckInput): Promise<Buffer> {
  const { data, business, language, generatedAt } = input
  const tr = (key: Key, params?: Record<string, string | number>) => t(language, key, params)
  const rtl = isRtlLanguage(language)
  const brand = data.brandColor ?? DEFAULT_BRAND
  const soft = tint(brand, 0.9)
  const softLine = tint(brand, 0.75)
  const dark = shade(brand, 0.35)
  const name = clean(business.name, 80) || CRM_NAME
  const s = data.summary
  const currency = (data.ads.insights.status === 'ok' && data.ads.insights.totals.currency) || s.revenue[0]?.currency || 'INR'
  const money = (v: number | null) => (v == null ? '—' : formatAmount(v, currency))
  const range = data.period.firstDay === data.period.lastDay ? dayLabel(data.period.firstDay, language) : `${dayLabel(data.period.firstDay, language)} – ${dayLabel(data.period.lastDay, language)}`
  const align = rtl ? 'right' : 'left'

  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_WIDE'
  pres.title = `${name} · ${tr('pDeck')} · ${range}`
  pres.author = CRM_NAME

  const footer = clean(`${name}  |  ${tr('lTitle')}  |  ${range}`, 160)
  pres.defineSlideMaster({
    title: 'CONTENT',
    background: { color: 'FFFFFF' },
    objects: [
      { text: { text: footer, options: { x: MX, y: H - 0.45, w: CW - 1, h: 0.3, fontSize: 10, color: MUTED, fontFace: FONT, margin: 0, align, rtlMode: rtl } } },
    ],
    slideNumber: { x: W - MX - 0.6, y: H - 0.45, w: 0.6, h: 0.3, fontSize: 10, color: MUTED, fontFace: FONT, align: 'right' },
  })

  // ── logo, checked whole before PowerPoint sees it ─────────────────
  const logoProblem = business.logo ? imageProblem(business.logo.mime, business.logo.bytes) : null
  if (logoProblem) console.error('[deck] logo skipped:', logoProblem)
  const logo = business.logo && !logoProblem ? business.logo : null
  const logoData = logo ? `image/${logo.mime === 'image/png' ? 'png' : 'jpeg'};base64,${logo.bytes.toString('base64')}` : null
  const addLogo = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number) => {
    if (!logoData) return
    try {
      slide.addImage({ data: logoData, x, y, w, h, sizing: { type: 'contain', w, h } })
    } catch (err) {
      console.error('[deck] logo skipped:', err instanceof Error ? err.message : String(err))
    }
  }

  const text = (slide: PptxGenJS.Slide, str: string, o: PptxGenJS.TextPropsOptions) =>
    slide.addText(clean(str, 300), { fontFace: FONT, color: INK, margin: 0, isTextBox: true, align, rtlMode: rtl, ...o })

  const title = (slide: PptxGenJS.Slide, str: string, sub: string | null) => {
    text(slide, str, { x: MX, y: 0.4, w: CW - 2.2, h: 0.7, fontSize: 30, bold: true, color: dark, valign: 'top' })
    if (sub) text(slide, sub, { x: MX, y: 1.1, w: CW - 2.2, h: 0.4, fontSize: 14, color: MUTED, valign: 'top' })
    addLogo(slide, W - MX - 1.8, 0.35, 1.8, 0.9)
  }

  /** A figure card: label, big value, a small line under it. */
  const card = (slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, label: string, value: string, sub: string | null, filled: boolean | 'gold' = false) => {
    const fill = filled === 'gold' ? GOLD : filled ? brand : soft
    const fg = filled ? 'FFFFFF' : INK
    const lab = filled ? 'FFFFFF' : dark
    slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: filled ? fill : softLine, width: 0.75 }, rectRadius: 0.08 })
    const big = value.length > 12 ? 20 : value.length > 9 ? 24 : 28
    text(slide, value, { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.6, fontSize: big, bold: true, color: fg, valign: 'middle', fit: 'shrink' })
    text(slide, label, { x: x + 0.15, y: y + 0.72, w: w - 0.3, h: 0.32, fontSize: 12.5, bold: true, color: lab, valign: 'top', fit: 'shrink' })
    if (sub) text(slide, sub, { x: x + 0.15, y: y + 1.04, w: w - 0.3, h: 0.3, fontSize: 10.5, color: filled ? 'FFFFFF' : MUTED, valign: 'top', fit: 'shrink' })
  }

  const chartFrame = {
    catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, dataLabelFontFace: FONT, legendFontFace: FONT,
    valGridLine: { color: LINE, size: 0.5 }, catGridLine: { style: 'none' as const },
  }

  // ── 1. cover ───────────────────────────────────────────────────────
  {
    const slide = pres.addSlide({ masterName: 'CONTENT' })
    slide.background = { color: 'FFFFFF' }
    addLogo(slide, MX, 0.6, 2.4, 1.2)
    text(slide, name, { x: MX, y: 2.1, w: CW, h: 0.8, fontSize: 36, bold: true, color: dark, valign: 'middle' })
    text(slide, tr('lTitle'), { x: MX, y: 2.9, w: CW, h: 0.6, fontSize: 24, color: INK, valign: 'middle' })
    text(slide, `${tr('pCoverSub', { range })} · ${data.period.timeZone}`, { x: MX, y: 3.5, w: CW, h: 0.4, fontSize: 14, color: MUTED })
    const three: Array<[string, string]> = [
      [tr('lLeads'), num(s.cohort.total)],
      [tr('lWon'), num(s.wonInPeriod)],
      [tr('lRevenue'), s.revenue.filter((m) => m.amount > 0).map((m) => formatAmount(m.amount, m.currency)).join(' + ') || '—'],
    ]
    const cw = (CW - 0.6) / 3
    three.forEach(([label, value], i) => card(slide, MX + i * (cw + 0.3), 4.5, cw, 1.4, label, value, null, i === 2))
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: data.period.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(generatedAt).replace(',', '')
    text(slide, tr('generatedOn', { date: `${stamp} ${data.period.timeZone}` }), { x: MX, y: 6.3, w: CW, h: 0.3, fontSize: 10, color: MUTED })
  }

  // ── 2. ads at a glance ─────────────────────────────────────────────
  {
    const slide = pres.addSlide({ masterName: 'CONTENT' })
    const ads = data.ads
    const ok = ads.insights.status === 'ok' ? ads.insights : null
    const prev = ads.previous.status === 'ok' ? ads.previous : null
    const days = data.period.days.length
    const sub = [tr('pChannels'), tr('pDaysN', { n: days }), ads.activeAds ? tr('pActiveAds', { n: ads.activeAds }) : null].filter(Boolean).join('  •  ')
    title(slide, tr('pAdsTitle'), sub)

    const spend = ok?.totals.spend ?? null
    const ctr = ok && ok.totals.impressions > 0 ? `${(Math.round((ok.totals.clicks / ok.totals.impressions) * 10000) / 100).toFixed(2)}%` : '—'
    const cpc = ok && ok.totals.clicks > 0 ? money(ok.totals.spend / ok.totals.clicks) : '—'
    const costPerConv = ok && ads.conversations > 0 ? ok.totals.spend / ads.conversations : null
    const prevCost = prev && ads.previousConversations > 0 ? prev.totals.spend / ads.previousConversations : null
    const reachChange = ok && prev ? changeText(ok.totals.reach, prev.totals.reach) : null
    const convChange = changeText(ads.conversations, ads.previousConversations)
    const costChange = costPerConv != null && prevCost != null ? changeText(costPerConv, prevCost) : null
    const cards: Array<[string, string, string | null, boolean]> = [
      [tr('pSpent'), money(spend), spend != null ? tr('pPerDayAvg', { v: money(spend / Math.max(1, days)) }) : null, false],
      [tr('pReach'), ok ? num(ok.totals.reach) : '—', reachChange ? tr('pVsLast', { d: reachChange.text }) : null, false],
      [tr('pImpressions'), ok ? num(ok.totals.impressions) : '—', ok?.totals.frequency != null ? tr('pFrequency', { v: ok.totals.frequency }) : null, false],
      [tr('pClicks'), ok ? num(ok.totals.clicks) : '—', ok ? tr('pCtr', { p: ctr, c: cpc }) : null, false],
      [tr('pConversations'), num(ads.conversations), convChange ? tr('pVsLast', { d: convChange.text }) : null, true],
      [tr('pCostPerConv'), money(costPerConv), costChange ? tr('pVsLast', { d: costChange.text }) : null, true],
    ]
    const cw = (CW - 5 * 0.2) / 6
    cards.forEach(([label, value, sub2, filled], i) => card(slide, MX + i * (cw + 0.2), 1.7, cw, 1.4, label, value, sub2, filled))

    if (!ok) text(slide, ads.insights.status === 'error' ? ads.insights.message : tr('pNotConnected'), { x: MX, y: 3.25, w: CW, h: 0.35, fontSize: 11, color: GOLD })

    const labels = data.period.days.map((d) => dayLabel(d, language))
    const spendByDay = new Map((ok?.byDay ?? []).map((d) => [d.day, d.spend]))
    const spendSeries = data.period.days.map((d) => spendByDay.get(d) ?? 0)
    text(slide, tr('pChartDaily'), { x: MX, y: 3.65, w: CW, h: 0.35, fontSize: 14, bold: true, color: INK })
    const chartY = 4.0
    const chartH = H - chartY - 0.65
    if (ok) {
      slide.addChart(
        [
          { type: pres.ChartType.bar, data: [{ name: tr('pSpendSeries'), labels, values: spendSeries }], options: { barGapWidthPct: 60, chartColors: [tint(brand, 0.45)] } },
          { type: pres.ChartType.line, data: [{ name: tr('pConvSeries'), labels, values: ads.conversationsByDay }], options: { chartColors: [brand], lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 7, secondaryValAxis: true, secondaryCatAxis: true, showValue: true, dataLabelPosition: 't', dataLabelColor: dark, dataLabelFontSize: 10, dataLabelFontBold: true } },
        ],
        {
          x: MX, y: chartY, w: CW, h: chartH, ...chartFrame,
          valAxes: [{ showValAxisTitle: false, valAxisLabelColor: MUTED, valAxisLabelFontSize: 10 }, { showValAxisTitle: false, valAxisLabelColor: brand, valAxisLabelFontSize: 10, valGridLine: { style: 'none' } }],
          catAxes: [{ catAxisLabelColor: MUTED, catAxisLabelFontSize: 10 }, { catAxisHidden: true }],
          showLegend: true, legendPos: 'b', legendFontSize: 10, legendColor: MUTED,
          // A combo chart takes its options second; pptxgenjs's typing calls that slot data.
        } as unknown as unknown[],
      )
    } else {
      slide.addChart(pres.ChartType.bar, [{ name: tr('pConvSeries'), labels, values: ads.conversationsByDay }], {
        x: MX, y: chartY, w: CW, h: chartH, ...chartFrame, chartColors: [brand], barGapWidthPct: 60,
        showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: dark, dataLabelFontSize: 10, showLegend: false,
      })
    }
  }

  // ── 3. leads by category and day ───────────────────────────────────
  {
    const slide = pres.addSlide({ masterName: 'CONTENT' })
    const label = clean(data.categoryLabel, 40) || tr('pCategory')
    const cat = data.categories
    const change = changeText(cat.total, cat.previousTotal)
    title(slide, tr('pCatTitle', { label }), change ? tr('pCatSub', { n: num(cat.total), d: change.text, m: num(cat.previousTotal) }) : `${num(cat.total)} ${tr('lLeads')}`)

    const days = data.period.days
    const manyDays = days.length > 14
    // More than two weeks: one column per week, so the table stays readable.
    const cols = manyDays ? Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7)) : days.map((d) => [d])
    const colLabel = (group: string[]) => manyDays ? `${dayLabel(group[0], language)}–${dayLabel(group[group.length - 1], language)}` : `${day2(group[0])} ${weekdayShort(group[0], language)}`
    const sum = (byDay: number[], group: string[]) => group.reduce((a, d) => a + (byDay[days.indexOf(d)] ?? 0), 0)
    const tableW = cols.length > 9 ? CW : CW - 4.1
    const head: PptxGenJS.TableCell[] = [
      { text: label, options: { bold: true, color: 'FFFFFF', fill: { color: dark }, align } },
      ...cols.map((g) => ({ text: colLabel(g), options: { bold: true, color: 'FFFFFF', fill: { color: dark }, align: 'center' as const } })),
      { text: tr('pTotal'), options: { bold: true, color: 'FFFFFF', fill: { color: dark }, align: 'center' as const } },
      { text: tr('pShare'), options: { bold: true, color: 'FFFFFF', fill: { color: dark }, align: 'center' as const } },
    ]
    const shown = cat.rows.slice(0, MAX_ROWS)
    const rest = cat.rows.slice(MAX_ROWS)
    const rowsOut = shown.map((r) => ({ label: r.label || tr('pNotSet'), byDay: r.byDay, total: r.total, share: r.share }))
    if (rest.length) {
      const byDay = days.map((_, i) => rest.reduce((a, r) => a + r.byDay[i], 0))
      rowsOut.push({ label: '…', byDay, total: rest.reduce((a, r) => a + r.total, 0), share: Math.round(rest.reduce((a, r) => a + r.share, 0) * 10) / 10 })
    }
    const body: PptxGenJS.TableRow[] = rowsOut.map((r, i) => {
      const fill = i % 2 ? { color: soft } : { color: 'FFFFFF' }
      return [
        { text: clean(r.label, 40), options: { bold: true, fill, align } },
        ...cols.map((g) => ({ text: sum(r.byDay, g) ? num(sum(r.byDay, g)) : '–', options: { fill, align: 'center' as const, color: sum(r.byDay, g) ? INK : MUTED } })),
        { text: num(r.total), options: { fill, align: 'center' as const, bold: true, color: dark } },
        { text: `${r.share}%`, options: { fill, align: 'center' as const } },
      ]
    })
    const avg = cat.total / Math.max(1, cols.length)
    const totals: PptxGenJS.TableRow = [
      { text: tr('pTotal'), options: { bold: true, fill: { color: softLine }, align } },
      ...cols.map((g) => {
        const v = sum(cat.dayTotals, g)
        return { text: num(v), options: { bold: true, fill: { color: softLine }, align: 'center' as const, color: v < avg * 0.6 && cat.total > 0 ? BAD : INK } }
      }),
      { text: num(cat.total), options: { bold: true, fill: { color: softLine }, align: 'center' as const, color: dark } },
      { text: cat.total ? '100%' : '—', options: { bold: true, fill: { color: softLine }, align: 'center' as const } },
    ]
    const firstW = Math.min(2.6, tableW * 0.3)
    const restW = (tableW - firstW) / (cols.length + 2)
    if (cat.total === 0) {
      text(slide, tr('nothing'), { x: MX, y: 1.8, w: CW, h: 0.4, fontSize: 14, color: MUTED })
    } else {
      slide.addTable([head, ...body, totals], {
        x: MX, y: 1.7, w: tableW, colW: [firstW, ...Array(cols.length + 2).fill(restW)],
        fontFace: FONT, fontSize: body.length > 10 ? 9 : 11, color: INK, rowH: body.length > 10 ? 0.26 : 0.34,
        border: { type: 'solid', pt: 0.5, color: LINE }, valign: 'middle', margin: 0.04,
      })
      if (cols.length <= 9 && shown.length > 0) {
        slide.addChart(pres.ChartType.doughnut, [{ name: label, labels: shown.map((r) => clean(r.label || tr('pNotSet'), 24)), values: shown.map((r) => r.total) }], {
          x: W - MX - 3.9, y: 1.7, w: 3.9, h: 4.6, holeSize: 55,
          chartColors: shown.map((_, i) => tint(brand, Math.min(0.85, i * 0.12))),
          showLegend: true, legendPos: 'b', legendFontSize: 9, legendColor: MUTED, legendFontFace: FONT,
          showPercent: true, showValue: false, dataLabelColor: 'FFFFFF', dataLabelFontSize: 9, dataLabelFontFace: FONT,
          showTitle: true, title: tr('pShare'), titleColor: INK, titleFontSize: 12, titleFontFace: FONT,
        })
      }
    }
  }

  // ── 4. funnel and team ─────────────────────────────────────────────
  {
    const slide = pres.addSlide({ masterName: 'CONTENT' })
    const f = data.funnel
    const open = f.stages.filter((st) => st.outcome !== 'lost')
    const wonStage = [...open].reverse().find((st) => st.outcome === 'won')
    const count = (key: string) => f.rows.find((r) => r.key === key)?.count ?? 0
    const pipeDeals = s.pipeline.reduce((a, m) => a + m.deals, 0)
    const sub = wonStage
      ? tr('pFunnelSub', { leads: num(s.cohort.total), won: num(count(wonStage.key)), wonLabel: clean(wonStage.label, 30), pipe: num(pipeDeals) })
      : `${num(s.cohort.total)} ${tr('lLeads')}`
    title(slide, tr('pFunnelTitle'), sub)

    const notConnected = Math.max(0, s.calls.total - s.calls.connected)
    const cards: Array<[string, string, string | null, boolean | 'gold']> = [
      [tr('pTotalLeads'), num(s.cohort.total), range, false],
      [tr('pCallsDone'), num(s.calls.total), tr('pLeadsPlusFollow'), false],
      [tr('pAttended'), num(s.calls.connected), tr('pOfCalls', { p: pctText(s.calls.connected, s.calls.total) }), false],
      [tr('pNotAttended'), num(notConnected), tr('pOfCalls', { p: pctText(notConnected, s.calls.total) }), false],
    ]
    const pathStages = open.filter((st) => st.outcome !== 'won').slice(0, 3)
    pathStages.forEach((st, i) => {
      const prevCount = i === 0 ? s.cohort.total : count(pathStages[i - 1].key)
      cards.push([clean(st.label, 24), num(count(st.key)), i === 0 ? tr('pOfLeads', { p: pctText(count(st.key), s.cohort.total) }) : tr('pOfPrev', { p: pctText(count(st.key), prevCount), prev: clean(pathStages[i - 1].label, 16) }), false])
    })
    if (wonStage) {
      const last = pathStages[pathStages.length - 1]
      cards.push([clean(wonStage.label, 24), num(count(wonStage.key)), last ? tr('pOfPrev', { p: pctText(count(wonStage.key), count(last.key)), prev: clean(last.label, 16) }) : null, true])
    }
    cards.push([tr('pPipelineDeals'), num(pipeDeals), s.pipeline.filter((m) => m.amount > 0).map((m) => formatAmount(m.amount, m.currency)).join(' + ') || null, 'gold'])
    const n = Math.min(cards.length, 9)
    const cw = (CW - (n - 1) * 0.15) / n
    cards.slice(0, n).forEach(([label, value, sub2, filled], i) => card(slide, MX + i * (cw + 0.15), 1.7, cw, 1.4, label, value, sub2, filled))

    // team table, left
    const panelW = 3.6
    const tableW = CW - panelW - 0.3
    const stageCols = open.slice(0, 5)
    const headCell = (txt: string, a: 'left' | 'right' | 'center' = 'center'): PptxGenJS.TableCell => ({ text: clean(txt, 22), options: { bold: true, color: 'FFFFFF', fill: { color: dark }, align: a, fontSize: 9.5 } })
    const head: PptxGenJS.TableRow = [headCell(tr('pTeamMember'), align), headCell(tr('pCalls')), headCell(tr('pAttended')), headCell(tr('pNotAttended')), headCell(tr('pAttendPct')), ...stageCols.map((st) => headCell(st.label)), headCell(tr('pWon'))]
    const team = data.team.filter((m) => m.calls + m.won + m.stages.reduce((a, b) => a + b, 0) > 0).slice(0, 10)
    const cell = (txt: string, o: Partial<PptxGenJS.TableCell['options']> = {}): PptxGenJS.TableCell => ({ text: txt, options: { align: 'center', ...o } })
    const rows: PptxGenJS.TableRow[] = team.map((m, i) => {
      const fill = { color: i % 2 ? soft : 'FFFFFF' }
      const att = m.calls > 0 ? Math.round((m.connected / m.calls) * 1000) / 10 : null
      return [
        cell(cleanPersonName(m.name) || tr('formerMember'), { align, bold: true, fill }),
        cell(num(m.calls), { fill }),
        cell(num(m.connected), { fill }),
        cell(num(m.notConnected), { fill, color: m.notConnected > m.connected && m.calls > 0 ? BAD : INK }),
        cell(att == null ? '—' : `${att}%`, { fill, color: att == null ? MUTED : att >= 60 ? GOOD : att < 40 ? BAD : INK, bold: att != null }),
        ...stageCols.map((_, si) => cell(num(m.stages[si] ?? 0), { fill })),
        cell(num(m.won), { fill, bold: true, color: dark }),
      ]
    })
    if (team.length) {
      const sumOf = (fn: (m: typeof team[number]) => number) => team.reduce((a, m) => a + fn(m), 0)
      const calls = sumOf((m) => m.calls)
      const conn = sumOf((m) => m.connected)
      rows.push([
        cell(tr('pTeamTotal'), { align, bold: true, fill: { color: softLine } }),
        cell(num(calls), { bold: true, fill: { color: softLine } }), cell(num(conn), { bold: true, fill: { color: softLine } }), cell(num(calls - conn), { bold: true, fill: { color: softLine } }),
        cell(pctText(conn, calls), { bold: true, fill: { color: softLine } }),
        ...stageCols.map((_, si) => cell(num(sumOf((m) => m.stages[si] ?? 0)), { bold: true, fill: { color: softLine } })),
        cell(num(sumOf((m) => m.won)), { bold: true, fill: { color: softLine }, color: dark }),
      ])
      const firstW = 1.9
      const restW = (tableW - firstW) / (head.length - 1)
      slide.addTable([head, ...rows], {
        x: MX, y: 3.4, w: tableW, colW: [firstW, ...Array(head.length - 1).fill(restW)],
        fontFace: FONT, fontSize: 10, color: INK, rowH: 0.3, border: { type: 'solid', pt: 0.5, color: LINE }, valign: 'middle', margin: 0.04,
      })
    } else {
      text(slide, tr('pNoTeam'), { x: MX, y: 3.5, w: tableW, h: 0.4, fontSize: 12, color: MUTED })
    }

    // conversion panel, right
    const px = W - MX - panelW
    slide.addShape(pres.ShapeType.roundRect, { x: px, y: 3.4, w: panelW, h: 3.5, fill: { color: dark }, line: { color: dark, width: 0 }, rectRadius: 0.1 })
    text(slide, tr('pConversion'), { x: px + 0.25, y: 3.55, w: panelW - 0.5, h: 0.35, fontSize: 12, bold: true, color: tint(GOLD, 0.3) })
    const lines: Array<[string, string, string | null]> = f.stages.length === 0
      ? [[tr('pNoStages'), '', null]]
      : f.conversions.slice(0, 3).map((c) => [`${clean(c.from, 18)} → ${clean(c.to, 18)}`, c.rate == null ? '—' : `${c.rate}%`, c.previousRate == null ? null : tr('pPrevWas', { p: `${c.previousRate}%` })])
    lines.push([tr('pAttendRate'), f.attendRate == null ? '—' : `${f.attendRate}%`, null])
    lines.slice(0, 4).forEach(([lbl, val, sub2], i) => {
      const y = 4.0 + i * 0.72
      text(slide, lbl, { x: px + 0.25, y, w: panelW - 1.6, h: 0.3, fontSize: 11, color: 'FFFFFF', valign: 'middle', fit: 'shrink' })
      if (sub2) text(slide, sub2, { x: px + 0.25, y: y + 0.3, w: panelW - 1.6, h: 0.25, fontSize: 9, color: tint(brand, 0.75), valign: 'top' })
      text(slide, val, { x: px + panelW - 1.35, y, w: 1.1, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF', align: 'right', valign: 'middle' })
    })
  }

  // ── 5. what needs doing ────────────────────────────────────────────
  {
    const slide = pres.addSlide({ masterName: 'CONTENT' })
    title(slide, tr('pTodoTitle'), tr('lOlder', { h: s.leakHours }))
    const items: Array<[string, number]> = [
      [tr('lTodoNever', { n: num(s.leaks.neverContacted.count) }), s.leaks.neverContacted.count],
      [tr('lTodoChats', { n: num(s.leaks.waitingChats.count) }), s.leaks.waitingChats.count],
      [tr('lTodoFollow', { n: num(s.leaks.overdueFollowUps.count) }), s.leaks.overdueFollowUps.count],
      [tr('lTodoUnassigned', { n: num(s.leaks.unassigned.count) }), s.leaks.unassigned.count],
    ]
    const live = items.filter(([, c]) => c > 0)
    if (live.length === 0) {
      text(slide, tr('lTodoNone'), { x: MX, y: 2.2, w: CW, h: 0.6, fontSize: 20, color: GOOD, bold: true })
    } else {
      const cw = (CW - (live.length - 1) * 0.3) / live.length
      live.forEach(([txt, c], i) => {
        const x = MX + i * (cw + 0.3)
        slide.addShape(pres.ShapeType.roundRect, { x, y: 1.9, w: cw, h: 2.0, fill: { color: i === 0 ? brand : soft }, line: { color: i === 0 ? brand : softLine, width: 0.75 }, rectRadius: 0.1 })
        text(slide, num(c), { x: x + 0.2, y: 2.05, w: cw - 0.4, h: 0.9, fontSize: 44, bold: true, color: i === 0 ? 'FFFFFF' : dark, valign: 'middle' })
        text(slide, txt.replace(/:\s*[\d,]+$/, ''), { x: x + 0.2, y: 2.95, w: cw - 0.4, h: 0.85, fontSize: 13, color: i === 0 ? 'FFFFFF' : INK, valign: 'top', fit: 'shrink' })
      })
    }
    const notes = [data.speedFinding, s.lostReasons[0] ? `${tr('lSecLost')}: ${clean(s.lostReasons[0].reason, 60)} (${num(s.lostReasons[0].count)})` : null].filter((x): x is string => Boolean(x))
    notes.forEach((n2, i) => text(slide, n2, { x: MX, y: 4.3 + i * 0.5, w: CW, h: 0.45, fontSize: 13, color: INK }))
    text(slide, tr('lNoteCredit'), { x: MX, y: 6.1, w: CW, h: 0.6, fontSize: 10, color: MUTED, valign: 'top' })
  }

  const out = await pres.write({ outputType: 'nodebuffer' })
  return withoutFolderEntries(Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer))
}

/**
 * pptxgenjs writes folder entries into the zip; files with them fail to open
 * or co-edit through cloud services (OneDrive, Google Drive). Re-zipped
 * with files only — PowerPoint needs nothing else.
 */
export async function withoutFolderEntries(pptx: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptx)
  const clean = new JSZip()
  const files = Object.values(zip.files).filter((f) => !f.dir)
  for (const f of files) clean.file(f.name, await f.async('uint8array'), { date: f.date, createFolders: false })
  return clean.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}

const day2 = (day: string) => String(Number(day.slice(8, 10)))
const pctText = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—')
