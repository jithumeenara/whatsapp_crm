/**
 * The Spending report as a PDF, in the business's language.
 *
 * A header with the business's name, address, tax number and logo; the
 * figures; the breakdowns as tables whose heading repeats on every page; a
 * vector chart; and on EVERY page the CRM's name and "Page X of Y". Built in
 * memory with pdfkit (text.ts places each word in the font of its own script
 * so Malayalam, Hindi, Tamil, Telugu, Kannada, Bengali and Arabic are right).
 * Tagged, with the document language set, so screen readers and PDF/UA
 * tools can follow it.
 *
 * What goes in: the report (counts and money by category, number, person,
 * team, channel and day) and the business's own details. What never does:
 * customer names or numbers: there are none in the report.
 */
import PDFDocument from 'pdfkit'
import { formatAmount } from '@/lib/format/money'
import { channelLabel, type Money, type SpendingReport } from '../spending-assemble'
import { imageProblem } from '@/lib/files/image-size'
import { isRtlLanguage, t, type Key } from '../i18n'
import { line, paragraph } from './text'

export type SpendingPdfReport = SpendingReport & {
  period: { firstDay: string; lastDay: string; partial: boolean; timeZone: string }
  warnings: string[]
}

export interface PdfBusiness {
  name: string
  /** Address, phone, email: one printed line each. */
  lines: string[]
  taxId: string | null
  /** PNG or JPEG bytes, already checked; null for no logo. */
  logo: { bytes: Buffer; mime: 'image/png' | 'image/jpeg' } | null
}

export interface BuildPdfInput {
  report: SpendingPdfReport
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

// Colours: the app's own indigo, in print-safe tones.
const INK = '#1f2937'
const MUTED = '#6b7280'
const BRAND = '#4338ca'
const SOFT = '#eef2ff'
const SOFT_LINE = '#c7d2fe'
const GREEN = '#10b981'

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

function moneyText(m: Money): string {
  const parts = Object.entries(m).map(([c, a]) => formatAmount(a, c))
  return parts.length ? parts.join(' + ') : '—'
}

const CATEGORY_KEY: Record<string, Key> = {
  marketing: 'catMarketing',
  utility: 'catUtility',
  authentication: 'catAuthentication',
  'authentication-international': 'catAuthInternational',
  service: 'catService',
  referral_conversion: 'catFreeEntry',
}

const FEATURE_KEY: Record<string, Key> = {
  chat_customer: 'featChat', chat_admin: 'featChat', admin_chat: 'featChat',
  translation: 'featTranslation',
  message_polish: 'featPolish',
  judgement: 'featJudgement',
  lead_detect: 'featLeadDetect',
  embedding: 'featKnowledge', retrieval: 'featKnowledge',
  transcription: 'featVoice', tts: 'featVoice', tts_cloud: 'featVoice', live_voice: 'featVoice',
  image_reading: 'featFiles', file_reading: 'featFiles', pdf_ocr: 'featFiles',
  template_kit: 'featTemplates', sheet_rule: 'featTemplates',
}

type Col = { label: string; frac: number; align: 'left' | 'right' }
type Doc = InstanceType<typeof PDFDocument>
type Tagged = {
  struct(type: string, opts?: Record<string, unknown>, fn?: () => void): { add(c: unknown): void; end(): void }
  addStructure(el: unknown): void
  markContent(tag: string, opts?: Record<string, unknown>): void
  endMarkedContent(): void
}

export async function buildSpendingPdf(input: BuildPdfInput): Promise<Buffer> {
  const { report: r, business, language, generatedAt, timeZone } = input
  const rtl = isRtlLanguage(language)
  const tr = (key: Key, params?: Record<string, string | number>) => t(language, key, params)
  const biz = r.businessCurrency
  const start = rtl ? 'right' : 'left'
  const end = rtl ? 'left' : 'right'

  const name = clean(business.name, 120) || CRM_NAME
  const doc = new PDFDocument({
    size: 'A4',
    margin: M,
    bufferPages: true, // footers need the total page count
    tagged: true,
    displayTitle: true,
    lang: language === 'en' ? 'en-US' : language,
    pdfVersion: '1.7',
    // pdfkit supports 'PDF/UA' (accessible PDF) though its typings do not list it.
    ...({ subset: 'PDF/UA' } as Record<string, unknown>),
    info: { Title: tr('title'), Author: name, Creator: CRM_NAME, Subject: tr('title') },
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  // ── tagging helpers ────────────────────────────────────────────────
  const d = doc as unknown as Tagged
  const root = d.struct('Document')
  d.addStructure(root)
  const tag = (parent: { add(c: unknown): void }, type: string, opts: Record<string, unknown>, fn: () => void) => {
    parent.add(d.struct(type, opts, fn))
  }
  const open = (parent: { add(c: unknown): void }, type: string) => {
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

  // ── header (first page): logo, business name, address, tax number ──
  const textW = CW - 64
  const textX = rtl ? M : M + 64
  const logoX = rtl ? W - M - 48 : M
  if (business.logo) {
    // pdfkit throws an uncatchable exception on a PNG with fine headers and
    // corrupt data, so the picture is checked whole before it is handed over.
    // A logo that cannot be used costs the report its logo, never the report.
    const problem = imageProblem(business.logo.mime, business.logo.bytes)
    if (problem) {
      console.error('[spending-pdf] logo skipped:', problem)
    } else {
      try {
        const bytes = business.logo.bytes
        tag(root, 'Figure', { alt: `${name} logo` }, () => {
          doc.image(bytes, logoX, y, { fit: [48, 48] })
        })
      } catch (err) {
        console.error('[spending-pdf] logo skipped:', err instanceof Error ? err.message : err)
      }
    }
  }
  tag(root, 'H1', {}, () => line(doc, name, textX, y, { size: 14, bold: true, color: BRAND, width: textW, align: start }))
  let hy = y + 20
  const headerLines = [...business.lines.map((l) => clean(l, 160)).filter(Boolean)]
  if (business.taxId) headerLines.push(clean(tr('taxId', { id: business.taxId }), 120))
  for (const l of headerLines.slice(0, 5)) {
    tag(root, 'P', {}, () => line(doc, l, textX, hy, { size: 8.5, color: MUTED, width: textW, align: start }))
    hy += 12
  }
  y = Math.max(hy, y + 52) + 6
  artifact('Layout', () => doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.8).strokeColor(SOFT_LINE).stroke())
  y += 12

  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(generatedAt).replace(',', '')
  tag(root, 'H2', {}, () => line(doc, tr('title'), M, y, { size: 18, bold: true, color: INK, width: CW, align: start }))
  y += 26
  const periodText = `${tr('period')}: ${r.period.firstDay === r.period.lastDay ? r.period.firstDay : `${r.period.firstDay} – ${r.period.lastDay}`} · ${r.period.timeZone}   ·   ${tr('generatedOn', { date: `${stamp} ${timeZone}` })}`
  tag(root, 'P', {}, () => line(doc, periodText, M, y, { size: 8.5, color: MUTED, width: CW, align: start }))
  y += 22

  // ── KPI cards: three across, two rows ──────────────────────────────
  const aiValue = r.ai.inBusinessCurrency
    ? formatAmount(r.ai.inBusinessCurrency.amount, r.ai.inBusinessCurrency.currency)
    : formatAmount(r.ai.costUsd, 'USD')
  const adsValue = !r.ads.connected ? tr('notConnected') : r.ads.spend === null ? tr('notAvailable') : formatAmount(r.ads.spend, r.ads.currency ?? biz)
  const kpis: Array<[string, string, string]> = [
    [tr('kTotal'), formatAmount(r.totals.combined, biz), ''],
    [tr('kWhatsapp'), moneyText(r.whatsapp.total), tr('subDelivered', { n: r.whatsapp.delivered, free: r.whatsapp.free })],
    [tr('kAi'), aiValue, tr('subCalls', { n: r.ai.calls })],
    [tr('kAds'), adsValue, ''],
    [tr('kCpl'), r.outcomes.costPerLead === null ? '—' : formatAmount(r.outcomes.costPerLead, biz), tr('subLeads', { n: r.outcomes.leads })],
    [tr('kCpw'), r.outcomes.costPerWon === null ? '—' : formatAmount(r.outcomes.costPerWon, biz), tr('subWon', { n: r.outcomes.wonDeals })],
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
      line(doc, label, kx + 8, ky + 8, { size: 8, color: BRAND, width: kw - 16, align: start })
      line(doc, value, kx + 8, ky + 22, { size: 13, bold: true, color: INK, width: kw - 16, align: start })
      if (sub) line(doc, sub, kx + 8, ky + 42, { size: 7.5, color: MUTED, width: kw - 16, align: start })
    })
  })
  y += 2 * kh + 10 + 14

  // ── notes: what was left out, and why ──────────────────────────────
  const notes: string[] = []
  if (r.totals.excluded.length) notes.push(tr('noteExcluded'))
  if (r.whatsapp.unpriced > 0) notes.push(tr('noteUnpriced'))
  if (r.whatsapp.pending > 0) notes.push(tr('notePending'))
  if (r.ads.error) notes.push(tr('noteAdsError'))
  for (const n of notes) {
    ensure(24)
    const ny = paragraph(doc, `• ${n}`, M, y, CW, { size: 8.5, color: '#92400e' })
    y = ny + 2
  }
  if (notes.length) y += 6

  // ── daily chart (vector) ───────────────────────────────────────────
  const section = (title: string) => {
    ensure(40)
    tag(root, 'H3', {}, () => line(doc, title, M, y, { size: 11, bold: true, color: INK, width: CW, align: start }))
    y += 18
  }

  section(tr('secDaily'))
  const aiRate = r.ai.inBusinessCurrency?.rate ?? null
  const days = r.byDay.map((x) => {
    const wa = x.whatsapp[biz] ?? Math.max(0, ...Object.values(x.whatsapp))
    const ai = aiRate !== null ? x.aiUsd * aiRate : 0
    return { day: x.day, wa, ai, total: wa + ai }
  })
  if (days.length === 0) {
    tag(root, 'P', {}, () => line(doc, tr('nothing'), M, y, { size: 9, color: MUTED, width: CW, align: start }))
    y += 18
  } else {
    const ch = 90
    ensure(ch + 36)
    const max = Math.max(1e-9, ...days.map((x) => x.total))
    const bw = CW / days.length
    const alt = `${tr('secDaily')}: ${days.map((x) => `${x.day} ${formatAmount(x.total, biz)}`).slice(0, 31).join(', ')}`
    tag(root, 'Figure', { alt }, () => {
      artifact('Layout', () => doc.moveTo(M, y + ch).lineTo(W - M, y + ch).lineWidth(0.5).strokeColor(SOFT_LINE).stroke())
      days.forEach((x, i) => {
        const col = rtl ? days.length - 1 - i : i
        const bx = M + col * bw + bw * 0.15
        const aiH = (x.ai / max) * ch
        const waH = (x.wa / max) * ch
        artifact('Layout', () => {
          doc.rect(bx, y + ch - aiH, bw * 0.7, aiH).fill(GREEN)
          doc.rect(bx, y + ch - aiH - waH, bw * 0.7, waH).fill(BRAND)
        })
      })
    })
    // The first day is at the start of the chart (the right edge when reading right to left).
    const first = days[0].day
    const last = days[days.length - 1].day
    line(doc, rtl ? last : first, M, y + ch + 3, { size: 7, color: MUTED, width: CW / 2 - 4, align: 'left' })
    line(doc, rtl ? first : last, M + CW / 2 + 4, y + ch + 3, { size: 7, color: MUTED, width: CW / 2 - 4, align: 'right' })
    y += ch + 16
    artifact('Layout', () => {
      doc.rect(rtl ? W - M - 8 : M, y + 2, 8, 8).fill(BRAND)
      doc.rect(rtl ? W - M - 8 : M, y + 16, 8, 8).fill(GREEN)
    })
    line(doc, tr('legendWhatsapp'), rtl ? M : M + 13, y, { size: 8, color: MUTED, width: CW - 13, align: start })
    if (aiRate !== null) line(doc, tr('legendAi'), rtl ? M : M + 13, y + 14, { size: 8, color: MUTED, width: CW - 13, align: start })
    y += aiRate !== null ? 34 : 20
  }

  // ── tables, heading repeated on each page ──────────────────────────
  const RH = 16
  const table = (title: string, cols0: Col[], data0: string[][]) => {
    section(title)
    if (data0.length === 0) {
      tag(root, 'P', {}, () => line(doc, tr('nothing'), M, y, { size: 9, color: MUTED, width: CW, align: start }))
      y += 20
      return
    }
    // Right to left: columns run the other way and the alignment mirrors.
    const cols = rtl ? cols0.slice().reverse().map((c) => ({ ...c, align: (c.align === 'right' ? 'left' : 'right') as 'left' | 'right' })) : cols0
    const data = rtl ? data0.map((row) => row.slice().reverse()) : data0
    const head = (structural: boolean, parent: { add(c: unknown): void } | null) => {
      const draw = (cell: (label: string, x: number, w: number, a: 'left' | 'right') => void) => {
        doc.rect(M, y, CW, RH).fill(BRAND)
        let cx = M
        for (const c of cols) {
          const w = CW * c.frac
          cell(c.label, cx, w, c.align)
          cx += w
        }
      }
      const cellText = (label: string, x: number, w: number, a: 'left' | 'right') =>
        line(doc, label, x + 5, y + 4, { size: 8, bold: true, color: '#ffffff', width: w - 10, align: a })
      if (structural && parent) {
        const row = open(parent, 'TR')
        doc.rect(M, y, CW, RH).fill(BRAND)
        let cx = M
        for (const c of cols) {
          const w = CW * c.frac
          tag(row, 'TH', { scope: 'Column' }, () => cellText(c.label, cx, w, c.align))
          cx += w
        }
        row.end()
      } else {
        // A heading repeated on a later page is decoration, not new content.
        artifact('Layout', () => draw(cellText))
      }
      y += RH
    }
    const tbl = d.struct('Table')
    root.add(tbl)
    ensure(RH * 2)
    head(true, tbl)
    const rows = data.slice(0, MAX_TABLE_ROWS)
    rows.forEach((cells, i) => {
      if (ensure(RH)) head(false, null)
      const row = open(tbl, 'TR')
      if (i % 2) artifact('Layout', () => doc.rect(M, y, CW, RH).fill('#f5f7ff'))
      let cx = M
      cols.forEach((c, ci) => {
        const w = CW * c.frac
        tag(row, 'TD', {}, () => line(doc, cells[ci] ?? '', cx + 5, y + 4, { size: 8, color: INK, width: w - 10, align: c.align }))
        cx += w
      })
      row.end()
      y += RH
    })
    tbl.end()
    y += 12
  }

  const label = (text: string, special: 'notAttributed' | 'notRecorded' | 'removedNumber' | 'formerMember' | 'aiAssistant' | 'system' | 'noTeam' | null) =>
    special ? tr(special) : text
  const LABEL_KEYS: Record<string, 'notAttributed' | 'notRecorded' | 'removedNumber' | 'formerMember' | 'aiAssistant' | 'system' | 'noTeam'> = {
    'Not attributed': 'notAttributed', 'Not recorded': 'notRecorded', 'Removed number': 'removedNumber',
    'Former member': 'formerMember', 'AI assistant': 'aiAssistant', System: 'system', 'No team': 'noTeam',
  }
  const nm = (text: string) => label(text, LABEL_KEYS[text] ?? null)

  table(tr('secCategory'), [
    { label: tr('colCategory'), frac: 0.46, align: 'left' }, { label: tr('colMessages'), frac: 0.2, align: 'right' }, { label: tr('colAmount'), frac: 0.34, align: 'right' },
  ], r.whatsapp.byCategory.map((c) => {
    const free = (c.type ?? '').startsWith('free')
    const base = CATEGORY_KEY[c.category ?? ''] ? tr(CATEGORY_KEY[c.category ?? '']) : (c.category ?? '—')
    return [`${base}${free ? ` (${tr('free')})` : ''}`, String(c.count), free ? tr('free') : moneyText(c.amount)]
  }))
  table(tr('secNumber'), [
    { label: tr('colName'), frac: 0.46, align: 'left' }, { label: tr('colMessages'), frac: 0.2, align: 'right' }, { label: tr('colAmount'), frac: 0.34, align: 'right' },
  ], r.whatsapp.byNumber.map((c) => [nm(c.label), String(c.count), moneyText(c.amount)]))
  table(tr('secPerson'), [
    { label: tr('colName'), frac: 0.46, align: 'left' }, { label: tr('colMessages'), frac: 0.2, align: 'right' }, { label: tr('colAmount'), frac: 0.34, align: 'right' },
  ], r.whatsapp.byPerson.map((p) => [nm(p.name), String(p.count), moneyText(p.amount)]))
  table(tr('secTeam'), [
    { label: tr('colTeam'), frac: 0.34, align: 'left' }, { label: tr('colPeople'), frac: 0.14, align: 'right' }, { label: tr('colWhatsapp'), frac: 0.28, align: 'right' }, { label: tr('colAiUsd'), frac: 0.24, align: 'right' },
  ], r.byTeam.map((x) => [nm(x.team), String(x.people), moneyText(x.whatsapp), formatAmount(x.aiUsd, 'USD')]))
  table(tr('secChannel'), [
    { label: tr('colChannel'), frac: 0.34, align: 'left' }, { label: tr('colMessages'), frac: 0.36, align: 'right' }, { label: tr('colAiUsd'), frac: 0.3, align: 'right' },
  ], r.byChannel.map((c) => [nm(channelLabel(c.channel)), moneyText(c.messages), formatAmount(c.aiUsd, 'USD')]))
  table(tr('secAiFeature'), [
    { label: tr('kAi'), frac: 0.5, align: 'left' }, { label: tr('colCalls'), frac: 0.2, align: 'right' }, { label: tr('colAiUsd'), frac: 0.3, align: 'right' },
  ], r.ai.byFeature.map((f) => [tr(FEATURE_KEY[f.feature] ?? 'featOther'), String(f.calls), formatAmount(f.costUsd, 'USD')]))
  table(tr('secAiPerson'), [
    { label: tr('colName'), frac: 0.5, align: 'left' }, { label: tr('colCalls'), frac: 0.2, align: 'right' }, { label: tr('colAiUsd'), frac: 0.3, align: 'right' },
  ], r.ai.byPerson.map((p) => [nm(p.name), String(p.calls), formatAmount(p.costUsd, 'USD')]))

  ensure(30)
  tag(root, 'P', {}, () => { y = paragraph(doc, tr('noteEstimate'), M, y, CW, { size: 8, color: MUTED }) })

  root.end()

  // ── footer on EVERY page: the CRM's name and "Page X of Y" ─────────
  const range = doc.bufferedPageRange()
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p)
    const saved = doc.page.margins.bottom
    doc.page.margins.bottom = 0 // writing in the margin must not add a page
    artifact('Pagination', () => {
      doc.moveTo(M, H - 34).lineTo(W - M, H - 34).lineWidth(0.5).strokeColor(SOFT_LINE).stroke()
      line(doc, CRM_NAME, M, H - 26, { size: 8, bold: true, color: BRAND, width: CW, align: start })
      line(doc, tr('pageOf', { n: p + 1, total: range.count }), M, H - 26, { size: 8, color: MUTED, width: CW, align: end })
    })
    doc.page.margins.bottom = saved
  }
  doc.end()
  // However it goes wrong, a request must end: a build that does not finish in
  // time is an error with a plain message, never a hung connection.
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
