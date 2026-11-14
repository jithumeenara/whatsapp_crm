import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { REPORT_LANGUAGES } from '@/lib/countries'
import type { PresentationData } from '../presentation'
import { buildDeck, changeText, shade, tint } from './presentation-pptx'

/**
 * The owner's report as slides: five slides, native charts PowerPoint can
 * edit, the business's colour, any report language, never a customer's
 * name or number, and a zip with no folder entries (cloud services refuse
 * those).
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
      previousRows: [], conversions: [{ from: 'Appointment', to: 'Visited', rate: 75, previousRate: 70 }, { from: 'Visited', to: 'Surgery', rate: 33.3, previousRate: null }],
      attendRate: 55.6, previousAttendRate: null,
    },
    team: [{ userId: 'u1', name: 'Parvathy', calls: 60, connected: 40, notConnected: 20, stages: [8, 6, 2], won: 2 }],
    speedFinding: null,
    ...over,
  }
}

const business = { name: 'SP Medifort Hospital', lines: [], taxId: null, logo: null }

async function slidesText(pptx: Buffer): Promise<{ zip: JSZip; slides: string[] }> {
  const zip = await JSZip.loadAsync(pptx)
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const slides = await Promise.all(names.map((n) => zip.file(n)!.async('string')))
  return { zip, slides }
}

describe('buildDeck', () => {
  it('makes five slides with native charts, the figures, the business colour and the category name', async () => {
    const pptx = await buildDeck({ data: data(), business, language: 'en', generatedAt: new Date('2026-10-13T10:00:00Z') })
    const { zip, slides } = await slidesText(pptx)
    expect(slides).toHaveLength(5)
    const all = slides.join('\n')
    for (const s of ['SP Medifort Hospital', 'Ads performance at a glance', 'Leads by Speciality and day', 'Varicose Vein', 'Parvathy', 'Appointment → Visited', '75%']) expect(all, s).toContain(s)
    expect(Object.keys(zip.files).some((n) => n.startsWith('ppt/charts/chart'))).toBe(true)
    // The business's own colour, not the app's default.
    expect(all.toLowerCase()).toContain('8b0a5c')
  })

  it('never carries a customer name or number', async () => {
    const { slides } = await slidesText(await buildDeck({ data: data(), business, language: 'en', generatedAt: new Date() }))
    const all = slides.join('\n')
    expect(all).not.toContain('Priya')
    expect(all).not.toContain('98470')
  })

  it('has no folder entries in the zip', async () => {
    const zip = await JSZip.loadAsync(await buildDeck({ data: data(), business, language: 'en', generatedAt: new Date() }))
    expect(Object.values(zip.files).filter((f) => f.dir)).toEqual([])
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
  })

  it('without an ad account it says so and still builds', async () => {
    const d = data({ ads: { ...data().ads, insights: { status: 'not_connected', message: 'Connect' } } })
    const { slides } = await slidesText(await buildDeck({ data: d, business, language: 'en', generatedAt: new Date() }))
    expect(slides[1]).toContain('Ad account not connected')
  })

  it('an empty period with no stages, no team and no categories still builds', async () => {
    const d = data({
      categories: { rows: [], dayTotals: [0, 0, 0], total: 0, previousTotal: 0 },
      funnel: { stages: [], rows: [], previousRows: [], conversions: [], attendRate: null, previousAttendRate: null },
      team: [],
    })
    const { slides } = await slidesText(await buildDeck({ data: d, business, language: 'en', generatedAt: new Date() }))
    expect(slides).toHaveLength(5)
    expect(slides.join('\n')).toContain('Set up your stages')
  })

  it('builds in every report language', async () => {
    for (const l of REPORT_LANGUAGES) {
      const { slides } = await slidesText(await buildDeck({ data: data(), business, language: l.code, generatedAt: new Date() }))
      expect(slides, l.code).toHaveLength(5)
    }
  }, 60_000)
})

describe('helpers', () => {
  it('tint, shade and change', () => {
    expect(tint('000000', 1)).toBe('ffffff')
    expect(shade('ffffff', 1)).toBe('000000')
    expect(tint('zzz', 0)).toBe('4338ca')
    expect(changeText(150, 109)).toEqual({ text: '▲ 38%', up: true })
    expect(changeText(5, 0)).toBeNull()
  })
})
