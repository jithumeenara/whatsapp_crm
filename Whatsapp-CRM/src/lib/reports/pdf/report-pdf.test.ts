import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { REPORT_LANGUAGES } from '@/lib/countries'
import type { PresentationData } from '../presentation'
import { speedRows } from '../reply-speed'
import { buildReportPdf, changeText, niceMax } from './report-pdf'

/**
 * The detailed landscape PDF: six pages (summary, ads, categories, funnel,
 * team, detail), vector charts, the business's colour, any report language,
 * the CRM name and "Page X of Y" on every page, and never a customer's name
 * or number.
 */

const leak = (count: number) => ({ count, rows: count ? [{ id: 'l1', title: 'Priya Nair 98470 12345', since: '2026-10-01T00:00:00Z', owner: 'Anu' }] : [] })
const days = ['2026-10-06', '2026-10-07', '2026-10-08']

function data(over: Partial<PresentationData> = {}): PresentationData {
  return {
    period: { kind: 'custom', firstDay: days[0], lastDay: days[2], timeZone: 'Asia/Kolkata', days, previousFirstDay: '2026-10-03', previousLastDay: '2026-10-05' },
    brandColor: '8b0a5c',
    categoryLabel: 'Speciality',
    summary: {
      scope: 'team', cohort: { total: 40, won: 3, lost: 5, closedNoOutcome: 0, open: 32 }, previousCohort: { total: 30, won: 2, lost: 4, closedNoOutcome: 0, open: 24 },
      wonInPeriod: 3, lostInPeriod: 5, previousWonInPeriod: 2, calls: { total: 90, connected: 50, previousTotal: 80, countedSince: null },
      revenue: [{ currency: 'INR', amount: 300000, deals: 3, withAmount: 3 }], previousRevenue: [], pipeline: [{ currency: 'INR', amount: 900000, deals: 9, withAmount: 9 }],
      pipelineByStage: [{ pipeline: 'Surgery', stage: 'Date fixed', deals: 4, amount: 400000, currency: 'INR' }],
      byCategory: [{ category: 'Varicose Vein', deals: 2, amount: 200000, currency: 'INR' }],
      bySource: [{ source: 'phone_call', total: 10, won: 1, lost: 1, closedNoOutcome: 0, open: 8 }],
      lostReasons: [{ reason: 'Cost concern', count: 3 }],
      leaks: { neverContacted: leak(4), overdueFollowUps: leak(1), unassigned: leak(0), waitingChats: leak(0) }, leakHours: 24,
      agents: [], funnel: [],
    } as unknown as PresentationData['summary'],
    ads: {
      insights: { status: 'ok', totals: { spend: 3000, reach: 20000, impressions: 40000, clicks: 400, frequency: 2, currency: 'INR' }, byDay: days.map((d) => ({ day: d, spend: 1000, clicks: 100 })) },
      previous: { status: 'not_connected', message: 'x' },
      conversationsByDay: [10, 12, 8], conversations: 30, previousConversations: 20, activeAds: 2,
    },
    categories: { rows: [{ label: 'Varicose Vein', byDay: [5, 6, 7], total: 18, share: 45 }, { label: '', byDay: [7, 8, 7], total: 22, share: 55 }], dayTotals: [12, 14, 14], total: 40, previousTotal: 30 },
    funnel: {
      stages: [{ key: 'a', label: 'Appointment', outcome: 'open' }, { key: 'v', label: 'Visited', outcome: 'open' }, { key: 's', label: 'Surgery', outcome: 'won' }],
      rows: [{ key: 'a', label: 'Appointment', outcome: 'open', count: 12 }, { key: 'v', label: 'Visited', outcome: 'open', count: 9 }, { key: 's', label: 'Surgery', outcome: 'won', count: 3 }],
      previousRows: [], conversions: [{ from: 'Appointment', to: 'Visited', rate: 75, previousRate: 70 }],
      attendRate: 55.6, previousAttendRate: null,
    },
    team: [{ userId: 'u1', name: 'Parvathy', calls: 60, connected: 40, notConnected: 20, stages: [8, 6, 2], won: 2 }],
    speedFinding: null,
    ...over,
  }
}

const business = { name: 'SP Medifort Hospital', lines: ['Thiruvananthapuram, Kerala'], taxId: '32AAAAA0000A1Z5', logo: null }
const speed = { countedSince: '2026-09-01T00:00:00Z', rows: speedRows([{ bucket: 'min5', leads: 20, won: 6 }]) }

async function pagesOf(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf))
  const { text } = await extractText(doc, { mergePages: false })
  return Array.isArray(text) ? text : [text]
}

const build = (over: Partial<Parameters<typeof buildReportPdf>[0]> = {}) =>
  buildReportPdf({ data: data(), speed, business, language: 'en', generatedAt: new Date('2026-10-13T10:00:00Z'), ...over })

describe('buildReportPdf', () => {
  it('six pages: summary, ads, categories, funnel, team, detail — each with the footer', async () => {
    const pages = await pagesOf(await build())
    expect(pages).toHaveLength(6)
    const flat = pages.map((p) => p.replace(/\s+/g, ' '))
    expect(flat[0]).toContain('SP Medifort Hospital')
    expect(flat[0]).toContain('Key findings')
    expect(flat[1]).toContain('Ads performance at a glance')
    expect(flat[1]).toContain('₹3,000')
    expect(flat[2]).toContain('Leads by Speciality and day')
    expect(flat[3]).toContain('Appointment › Visited')
    expect(flat[4]).toContain('Parvathy')
    expect(flat[5]).toContain('Cost concern')
    flat.forEach((p, i) => {
      expect(p, `page ${i + 1}`).toContain('Lead Magnet CRM')
      expect(p, `page ${i + 1}`).toContain(`Page ${i + 1} of 6`)
    })
  })

  it('never carries a customer name or number', async () => {
    const all = (await pagesOf(await build())).join('\n')
    expect(all).not.toContain('Priya')
    expect(all).not.toContain('98470')
  })

  it('prints no arrow the fonts cannot draw (they showed as empty boxes)', async () => {
    const all = (await pagesOf(await build())).join('\n')
    expect(all).not.toMatch(/[→▲▼]/)
    expect(all).toContain('+33%')
  })

  it('reads a stored source key as words', async () => {
    const all = (await pagesOf(await build())).join('\n')
    expect(all).toContain('Phone call')
  })

  it('without an ad account it says so and still builds', async () => {
    const pages = await pagesOf(await build({ data: data({ ads: { ...data().ads, insights: { status: 'not_connected', message: 'Connect' } } }) }))
    expect(pages[1]).toContain('Ad account not connected')
  })

  it('an empty period with no stages, team or categories still builds six pages', async () => {
    const pages = await pagesOf(await build({
      speed: null,
      data: data({
        categories: { rows: [], dayTotals: [0, 0, 0], total: 0, previousTotal: 0 },
        funnel: { stages: [], rows: [], previousRows: [], conversions: [], attendRate: null, previousAttendRate: null },
        team: [],
      }),
    }))
    expect(pages).toHaveLength(6)
    expect(pages.join('\n')).toContain('Set up your stages')
  })

  it('a hostile team member name cannot break the layout', async () => {
    const pdf = await build({ data: data({ team: [{ userId: 'u1', name: `‮${'x'.repeat(5000)}\u0000`, calls: 1, connected: 1, notConnected: 0, stages: [1, 0, 0], won: 0 }] }) })
    expect(pdf.length).toBeGreaterThan(5000)
  })

  it('builds in every report language', async () => {
    for (const l of REPORT_LANGUAGES) {
      const pages = await pagesOf(await build({ language: l.code }))
      expect(pages, l.code).toHaveLength(6)
    }
  }, 90_000)
})

describe('helpers', () => {
  it('axis tops step in 1, 2 or 5 so counts read 0 10 20 30 40', () => {
    expect(niceMax(30)).toBe(40)
    expect(niceMax(29)).toBe(40)
    expect(niceMax(1563)).toBe(2000)
    expect(niceMax(0)).toBe(4)
    expect(niceMax(3)).toBe(4)
  })

  it('change is +n% / -n%, nothing without a before', () => {
    expect(changeText(142, 105)).toBe('+35%')
    expect(changeText(5, 10)).toBe('-50%')
    expect(changeText(5, 0)).toBeNull()
  })
})
