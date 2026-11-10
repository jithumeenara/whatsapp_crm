import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { REPORT_LANGUAGES } from '@/lib/countries'
import type { ReportSummary } from '../summary'
import { speedRows } from '../reply-speed'
import { buildLeadsPdf } from './leads-pdf'
import type { PdfBusiness } from './spending-pdf'

/**
 * The Leads report as a PDF: the business header, the six figures, the
 * breakdowns, and the CRM's name with "Page X of Y" on every page — in any
 * language Settings offers. Never a customer's name or number.
 */

const leak = (count: number) => ({ count, rows: count ? [{ id: 'l1', title: 'Priya Nair 98470 12345', since: '2026-11-01T00:00:00Z', owner: 'Anu' }] : [] })

const agent = (i: number) => ({
  userId: `u${i}`, name: `Agent ${i}`, leads: 10 + i, calls: 20, connected: 12, won: 2, lost: 1, overdueFollowUps: 0, daysWorked: 5, medianFirstReplyMinutes: 7,
})

function summary(over: Partial<ReportSummary> = {}): ReportSummary {
  return {
    generatedAt: '2026-11-09T10:00:00Z',
    scope: 'team',
    cohort: { total: 160, won: 12, lost: 30, closedNoOutcome: 3, open: 115 },
    previousCohort: { total: 125, won: 10, lost: 20, closedNoOutcome: 1, open: 94 },
    excluded: 0,
    wonInPeriod: 12, lostInPeriod: 30, previousWonInPeriod: 10,
    calls: { total: 300, connected: 180, previousTotal: 250, countedSince: null },
    revenue: [{ currency: 'INR', amount: 120000.5, deals: 4, withAmount: 4 }],
    previousRevenue: [{ currency: 'INR', amount: 90000, deals: 3, withAmount: 3 }],
    lostAmount: [],
    pipeline: [{ currency: 'INR', amount: 450000, deals: 18, withAmount: 15 }],
    pipelineByStage: [{ pipeline: 'Admissions', stage: 'Counselling', deals: 8, amount: 200000, currency: 'INR' }],
    wonWithoutDate: 0,
    bySource: [{ source: 'whatsapp', total: 100, won: 8, lost: 10, closedNoOutcome: 0, open: 82 }, { source: 'Unknown', total: 60, won: 4, lost: 20, closedNoOutcome: 3, open: 33 }],
    byCategory: [{ category: 'Nursing', deals: 3, amount: 90000, currency: 'INR' }],
    lostReasons: [{ reason: 'Price too high', count: 12 }],
    leaks: { neverContacted: leak(10), overdueFollowUps: leak(3), unassigned: leak(2), waitingChats: leak(0) },
    leakHours: 24,
    agents: [agent(1), agent(2)],
    funnel: [
      { key: 'new', label: 'Enquiry', outcome: 'open', count: 160 },
      { key: 'visit', label: 'Campus visit', outcome: 'open', count: 40 },
      { key: 'won', label: 'Admitted', outcome: 'won', count: 12 },
    ],
    ...over,
  } as ReportSummary
}

const business: PdfBusiness = {
  name: 'Malabar Skills Academy',
  lines: ['12/345 Mavoor Road, Kozhikode, Kerala'],
  taxId: '29AAAAA0000A1Z5',
  logo: null,
}

const speed = { countedSince: '2026-10-01T00:00:00Z', rows: speedRows([{ bucket: 'min5', leads: 20, won: 6 }, { bucket: 'later', leads: 3, won: 0 }]) }

async function pagesOf(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf))
  const { text } = await extractText(doc, { mergePages: false })
  return Array.isArray(text) ? text : [text]
}

const build = (over: Partial<Parameters<typeof buildLeadsPdf>[0]> = {}) =>
  buildLeadsPdf({
    summary: summary(), speed, period: { firstDay: '2026-11-01', lastDay: '2026-11-09', timeZone: 'Asia/Kolkata' },
    business, language: 'en', generatedAt: new Date('2026-11-09T10:00:00Z'), timeZone: 'Asia/Kolkata', ...over,
  })

describe('buildLeadsPdf', () => {
  it('makes a real PDF: business header, figures, stages, sources, speed, team, CRM name in the footer', async () => {
    const pdf = await build()
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const all = (await pagesOf(pdf)).join('\n').replace(/\s+/g, ' ')
    for (const s of ['Malabar Skills Academy', '29AAAAA0000A1Z5', 'Leads report', 'Revenue won', '₹1,20,000.50', 'Campus visit', 'Price too high', 'Within 5 minutes', 'Agent 1', 'Lead Magnet CRM', 'Leads nobody has contacted: 10']) {
      expect(all, s).toContain(s)
    }
    expect(all).toMatch(/Page 1 of \d+/)
  })

  it('never carries a customer name or number, only counts', async () => {
    const all = (await pagesOf(await build())).join('\n')
    expect(all).not.toContain('Priya')
    expect(all).not.toContain('98470')
  })

  it('a long team list runs onto more pages, each with the footer and the table heading again', async () => {
    const pdf = await build({ summary: summary({ agents: Array.from({ length: 120 }, (_, i) => agent(i)) }) })
    const pages = await pagesOf(pdf)
    expect(pages.length).toBeGreaterThan(2)
    pages.forEach((p, i) => expect(p, `page ${i + 1}`).toContain(`Page ${i + 1} of ${pages.length}`))
    // A page after the first that continues the team table shows its heading again.
    const continued = pages.slice(1).filter((p) => /Agent \d+/.test(p))
    expect(continued.length).toBeGreaterThan(0)
    continued.forEach((p) => expect(p).toContain('Median reply'))
  })

  it('an empty period still builds, saying there is nothing', async () => {
    const empty = summary({
      cohort: { total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0 }, bySource: [], lostReasons: [], pipelineByStage: [], byCategory: [], agents: [], funnel: [],
      revenue: [], pipeline: [], leaks: { neverContacted: leak(0), overdueFollowUps: leak(0), unassigned: leak(0), waitingChats: leak(0) },
    })
    const all = (await pagesOf(await build({ summary: empty, speed: null }))).join('\n')
    expect(all).toContain('Nothing is waiting.')
    expect(all).toContain('Nothing in this period.')
  })

  it('a hostile team member name cannot break the layout', async () => {
    const pdf = await build({ summary: summary({ agents: [{ ...agent(1), name: `‮${'x'.repeat(5000)}\u0000` }] }) })
    expect(pdf.length).toBeGreaterThan(5000)
  })

  it('is written in every language Settings offers, without throwing', async () => {
    for (const l of REPORT_LANGUAGES) {
      const pdf = await build({ language: l.code })
      const [first] = await pagesOf(pdf)
      expect(first, l.code).toContain('Lead Magnet CRM')
    }
  }, 60_000)
})
