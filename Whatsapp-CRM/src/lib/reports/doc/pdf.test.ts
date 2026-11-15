import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { REPORT_LANGUAGES } from '@/lib/countries'
import { changeText, docToPdf, fmtValue, niceMax } from './pdf'
import type { DocBusiness, ReportDoc } from './types'

/**
 * Any ReportDoc as a landscape PDF: every block kind drawn, the CRM name and
 * "Page X of Y" on every page, no glyph the fonts cannot draw, an empty doc
 * still builds, and every report language builds.
 */

function sample(over: Partial<ReportDoc> = {}): ReportDoc {
  const days = ['1 Oct', '2 Oct', '3 Oct', '4 Oct', '5 Oct', '6 Oct', '7 Oct']
  return {
    key: 'leads',
    title: 'Leads report',
    headline: 'Leads rose 35% → 142, and replies got faster.',
    period: { kind: 'week', firstDay: '2026-10-01', lastDay: '2026-10-07', timeZone: 'Asia/Kolkata', previous: { firstDay: '2026-09-24', lastDay: '2026-09-30' } },
    scope: 'team',
    generatedAt: '2026-10-08T04:00:00.000Z',
    notes: ['Data since 1 September.', 'Too few calls to judge reply speed.'],
    blocks: [
      {
        kind: 'kpis', id: 'k', title: 'At a glance', items: [
          { label: 'Leads', value: '142', compare: { now: 142, before: 105, higherIsBetter: true, fmt: { kind: 'count' } } },
          { label: 'Cost per lead', value: '₹88', compare: { now: 88, before: 80, higherIsBetter: false, fmt: { kind: 'money', currency: 'INR' } } },
          { label: 'Won', value: '9', compare: { now: 9, before: 7, higherIsBetter: true, small: true, fmt: { kind: 'count' } } },
          { label: 'Reply time', value: '12 min', sub: 'median first reply' },
          { label: 'Revenue', value: '₹12,50,000', tone: 'brand', compare: { now: 1250000, before: 900000, higherIsBetter: true, fmt: { kind: 'money', currency: 'INR' } } },
          { label: 'Attend rate', value: '55.9%', sub: '55.9% of calls', tone: 'money' },
          { label: 'Lost', value: '14', tone: 'bad' },
        ],
      },
      { kind: 'chart', id: 'c1', title: 'Leads by day', chart: 'bar', labels: days, series: [{ name: 'Leads', values: [12, 25, 18, 30, 22, 19, 16], previous: [10, 14, 15, 20, 18, 16, 12] }] },
      { kind: 'chart', id: 'c2', title: 'Replies by day', chart: 'line', labels: days, series: [{ name: 'Reply minutes', values: [14, 12, 11, 9, 13, 10, 8], previous: [18, 17, 15, 16, 14, 15, 13], fmt: { kind: 'minutes' } }] },
      {
        kind: 'chart', id: 'c3', title: 'Spend vs conversations', chart: 'barline', labels: days, series: [
          { name: 'Spend', values: [1000, 1250, 900, 1400, 1100, 980, 1020], kind: 'bar', fmt: { kind: 'money', currency: 'INR' } },
          { name: 'Conversations', values: [10, 14, 8, 17, 12, 11, 9], kind: 'line', axis: 'right' },
        ],
      },
      { kind: 'chart', id: 'c4', title: 'Where leads came from', chart: 'hbar', labels: ['WhatsApp', 'Facebook ads', 'Website', 'Walk-in'], series: [{ name: 'Leads', values: [70, 40, 22, 10], previous: [50, 35, 12, 8] }] },
      { kind: 'chart', id: 'c5', title: 'Funnel', chart: 'funnel', labels: ['All leads', 'Contacted', 'Appointment', 'Visited', 'Won'], series: [{ name: 'Leads', values: [142, 120, 60, 35, 9] }], note: 'Each stage counts leads that reached it.' },
      {
        kind: 'table', id: 't1', title: 'Team',
        columns: [{ label: 'Team member', width: 2 }, { label: 'Calls', fmt: { kind: 'count' } }, { label: 'Won', fmt: { kind: 'count' } }, { label: 'Revenue', fmt: { kind: 'money', currency: 'INR' } }],
        rows: [
          [{ text: 'Parvathy' }, { text: '60', value: 60 }, { text: '4', value: 4, tone: 'good' }, { text: '₹5,00,000', value: 500000 }],
          [{ text: 'Arun' }, { text: '45', value: 45 }, { text: '1', value: 1, tone: 'bad' }, { text: '₹1,00,000', value: 100000 }],
          [{ text: '=HYPERLINK("http://x")' }, { text: '1', value: 1 }, { text: '0', value: 0 }, { text: '₹0', value: 0 }],
        ],
        total: [{ text: 'Team total' }, { text: '106', value: 106 }, { text: '5', value: 5 }, { text: '₹6,00,000', value: 600000 }],
        note: 'A win counts for whoever closed the lead.',
      },
      { kind: 'text', id: 'x1', title: 'In short', style: 'headline', lines: ['A strong week.'] },
      { kind: 'text', id: 'x2', style: 'bullets', lines: ['Facebook ads brought 40 leads.', 'Walk-ins fell ▼ 20%.'] },
      { kind: 'text', id: 'x3', style: 'note', lines: ['Amounts in different currencies are never added together.'] },
      { kind: 'text', id: 'x4', style: 'warning', lines: ['The ad account is not connected.'] },
      {
        kind: 'findings', id: 'f', title: 'Findings', items: [
          { severity: 'high', title: 'Slow first replies on Sunday', evidence: 'Median first reply was 48 minutes on Sunday against 12 on other days.', suggestion: 'Put one person on the Sunday rota.' },
          { severity: 'good', title: 'Facebook ads are paying off', evidence: 'Cost per lead fell from ₹110 to ₹88.', suggestion: 'Keep the budget.', byAi: true },
          { severity: 'medium', title: 'Many leads still open', evidence: '32 leads have had no call.', suggestion: 'Call them first.' },
          { severity: 'low', title: 'Walk-ins fell', evidence: 'Ten walk-ins, from twelve.', suggestion: '' },
        ],
      },
    ],
    ...over,
  }
}

const business: DocBusiness = { name: 'SP Medifort Hospital', lines: ['Thiruvananthapuram, Kerala'], taxId: '32AAAAA0000A1Z5', logo: null, brandColor: '8b0a5c' }
const at = new Date('2026-10-08T04:00:00Z')

async function pagesOf(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf))
  const { text } = await extractText(doc, { mergePages: false })
  return (Array.isArray(text) ? text : [text]).map((p) => p.replace(/\s+/g, ' '))
}

describe('docToPdf', () => {
  it('draws every block kind, with the footer on every page', async () => {
    const pdf = await docToPdf({ doc: sample(), business, language: 'en', generatedAt: at })
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const pages = await pagesOf(pdf)
    expect(pages.length).toBeGreaterThan(1)
    const all = pages.join('\n')
    for (const s of ['Leads report', 'SP Medifort Hospital', '142', 'Before: 105 · +35%', 'Parvathy', 'Team total', 'Slow first replies on Sunday', 'Written by AI', 'HIGH', 'What to do: Put one person on the Sunday rota.', 'Data since 1 September.', 'Compared with 2026-09-24 – 2026-09-30', 'Leads (before)', 'Where leads came from', 'WhatsApp', 'Contacted']) {
      expect(all, s).toContain(s)
    }
    pages.forEach((p, i) => {
      expect(p, `page ${i + 1}`).toContain('Lead Magnet CRM')
      expect(p, `page ${i + 1}`).toContain(`Page ${i + 1} of ${pages.length}`)
    })
  })

  it('prints no arrow the fonts cannot draw', async () => {
    const all = (await pagesOf(await docToPdf({ doc: sample(), business, language: 'en', generatedAt: at }))).join('\n')
    expect(all).not.toMatch(/[→▲▼]/)
  })

  it('repeats the table header on a continuation page and keeps every row', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => [{ text: `Person ${i + 1}` }, { text: String(i), value: i }])
    const doc = sample({ blocks: [{ kind: 'table', id: 't', title: 'Long table', columns: [{ label: 'Name' }, { label: 'Calls', fmt: { kind: 'count' } }], rows }] })
    const pages = await pagesOf(await docToPdf({ doc, business, language: 'en', generatedAt: at }))
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[1]).toContain('Long table (continued)')
    expect(pages[1]).toContain('Calls')
    expect(pages.join('\n')).toContain('Person 70')
  })

  it('an empty doc (no blocks, no notes) still builds', async () => {
    const pdf = await docToPdf({ doc: sample({ blocks: [], notes: [], headline: undefined }), business: { ...business, lines: [], taxId: null, brandColor: null }, language: 'en', generatedAt: at })
    const pages = await pagesOf(pdf)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('Page 1 of 1')
  })

  it('hostile and huge text cannot break the build', async () => {
    const evil = `‮${'x'.repeat(5000)}\u0000 A & B <script>`
    const doc = sample({ title: evil, blocks: [{ kind: 'kpis', id: 'k', items: [{ label: evil, value: evil }] }, { kind: 'chart', id: 'c', title: evil, chart: 'bar', labels: [evil], series: [{ name: evil, values: [Number.NaN] }] }] })
    const pdf = await docToPdf({ doc, business: { ...business, name: evil, brandColor: 'zzzzzz' }, language: 'en', generatedAt: at })
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('builds in every report language', async () => {
    for (const l of REPORT_LANGUAGES) {
      const pdf = await docToPdf({ doc: sample(), business, language: l.code, generatedAt: at })
      expect(pdf.subarray(0, 5).toString('latin1'), l.code).toBe('%PDF-')
    }
  }, 60_000)
})

describe('helpers', () => {
  it('axis tops step in 1, 2 or 5', () => {
    expect(niceMax(30)).toBe(40)
    expect(niceMax(1563)).toBe(2000)
    expect(niceMax(0)).toBe(4)
  })

  it('change is +n% / -n%, nothing without a before', () => {
    expect(changeText(142, 105)).toBe('+35%')
    expect(changeText(5, 10)).toBe('-50%')
    expect(changeText(5, 0)).toBeNull()
    expect(changeText(null, 3)).toBeNull()
  })

  it('formats by Fmt', () => {
    expect(fmtValue(1234, { kind: 'count' }, 'en')).toBe('1,234')
    expect(fmtValue(55.94, { kind: 'percent', digits: 1 }, 'en')).toBe('55.9%')
    expect(fmtValue(12, { kind: 'minutes' }, 'en')).toBe('12 min')
    expect(fmtValue(null, { kind: 'count' }, 'en')).toBe('—')
    expect(fmtValue(500, { kind: 'money', currency: 'INR' }, 'en')).toBe('₹500.00')
  })
})
