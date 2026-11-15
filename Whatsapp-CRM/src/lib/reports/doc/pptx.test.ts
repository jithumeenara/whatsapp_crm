import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { docToPptx } from './pptx'
import type { DocBusiness, ReportDoc, TableCell } from './types'

/**
 * Any ReportDoc as slides: a cover, native charts and tables, long tables
 * split with "(continued)", text and findings on slides of their own, no
 * folder entries in the zip, and hostile text escaped in slide and chart XML.
 */

function sample(over: Partial<ReportDoc> = {}): ReportDoc {
  const days = ['1 Oct', '2 Oct', '3 Oct']
  return {
    key: 'leads',
    title: 'Leads report',
    headline: 'Leads rose 35% to 142.',
    period: { kind: 'week', firstDay: '2026-10-01', lastDay: '2026-10-07', timeZone: 'Asia/Kolkata', previous: { firstDay: '2026-09-24', lastDay: '2026-09-30' } },
    scope: 'team',
    generatedAt: '2026-10-08T04:00:00.000Z',
    notes: ['Data since 1 September.'],
    blocks: [
      { kind: 'kpis', id: 'k', title: 'At a glance', items: [{ label: 'Leads', value: '142', compare: { now: 142, before: 105, higherIsBetter: true, fmt: { kind: 'count' } } }, { label: 'Revenue', value: '₹12,50,000', tone: 'brand' }] },
      { kind: 'chart', id: 'c1', title: 'Leads by day', chart: 'bar', labels: days, series: [{ name: 'Leads', values: [12, 25, 18], previous: [10, 14, 15] }] },
      { kind: 'chart', id: 'c2', title: 'Reply time', chart: 'line', labels: days, series: [{ name: 'Minutes', values: [14, 12, 11], fmt: { kind: 'minutes' } }] },
      { kind: 'chart', id: 'c3', title: 'Spend vs conversations', chart: 'barline', labels: days, series: [{ name: 'Spend', values: [1000, 1250, 900], kind: 'bar', fmt: { kind: 'money', currency: 'INR' } }, { name: 'Conversations', values: [10, 14, 8], kind: 'line', axis: 'right' }] },
      { kind: 'chart', id: 'c4', title: 'Sources', chart: 'hbar', labels: ['WhatsApp', 'Website'], series: [{ name: 'Leads', values: [70, 22] }] },
      { kind: 'chart', id: 'c5', title: 'Funnel', chart: 'funnel', labels: ['All', 'Contacted', 'Won'], series: [{ name: 'Leads', values: [142, 120, 9] }] },
      {
        kind: 'table', id: 't1', title: 'Team',
        columns: [{ label: 'Team member', width: 2 }, { label: 'Calls', fmt: { kind: 'count' } }],
        rows: [[{ text: 'Parvathy' }, { text: '60', value: 60, tone: 'good' }]],
        total: [{ text: 'Team total' }, { text: '60', value: 60 }],
      },
      { kind: 'text', id: 'x', title: 'In short', style: 'bullets', lines: ['One.', 'Two.'] },
      { kind: 'findings', id: 'f', items: [{ severity: 'high', title: 'Slow replies on Sunday', evidence: '48 min on Sunday.', suggestion: 'Add a Sunday rota.', byAi: true }] },
    ],
    ...over,
  }
}

const business: DocBusiness = { name: 'SP Medifort Hospital', lines: ['Kerala'], taxId: null, logo: null, brandColor: '8b0a5c' }
const at = new Date('2026-10-08T04:00:00Z')

async function open(pptx: Buffer) {
  const zip = await JSZip.loadAsync(pptx)
  const byNum = (re: RegExp) => Object.keys(zip.files).filter((n) => re.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
  const slides = await Promise.all(byNum(/^ppt\/slides\/slide\d+\.xml$/).map((n) => zip.file(n)!.async('string')))
  const charts = await Promise.all(byNum(/^ppt\/charts\/chart\d+\.xml$/).map((n) => zip.file(n)!.async('string')))
  return { zip, slides, charts }
}

describe('docToPptx', () => {
  it('a cover, then slides for every block, with native charts and tables', async () => {
    const { zip, slides, charts } = await open(await docToPptx({ doc: sample(), business, language: 'en', generatedAt: at }))
    // cover + kpis + 5 charts + table + text + findings + notes
    expect(slides).toHaveLength(11)
    expect(slides[0]).toContain('SP Medifort Hospital')
    expect(slides[0]).toContain('Leads rose 35% to 142.')
    expect(charts).toHaveLength(5)
    // barline is a combo: bars and a line on a second axis
    const combo = charts.find((c) => c.includes('Conversations'))!
    expect(combo).toContain('<c:barChart>')
    expect(combo).toContain('<c:lineChart>')
    expect((combo.match(/<c:valAx>/g) ?? []).length).toBe(2)
    // hbar and funnel are horizontal bars
    expect(charts.filter((c) => c.includes('<c:barDir val="bar"/>'))).toHaveLength(2)
    const all = slides.join('\n')
    for (const s of ['142', 'Before: 105 · +35%', 'Parvathy', 'Team total', '<a:tbl>', 'Slow replies on Sunday', 'Written by AI', 'HIGH', 'Data since 1 September.']) expect(all, s).toContain(s)
    expect(all.toLowerCase()).toContain('8b0a5c')
    expect(all).not.toMatch(/val="#/)
    expect(Object.values(zip.files).filter((f) => f.dir)).toEqual([])
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
  })

  it('splits a long table across slides, marked "(continued)"', async () => {
    const rows: TableCell[][] = Array.from({ length: 30 }, (_, i) => [{ text: `Person ${i + 1}` }, { text: String(i), value: i }])
    const doc = sample({ notes: [], headline: undefined, blocks: [{ kind: 'table', id: 't', title: 'Long table', columns: [{ label: 'Name' }, { label: 'Calls' }], rows }] })
    const { slides } = await open(await docToPptx({ doc, business, language: 'en', generatedAt: at }))
    expect(slides).toHaveLength(1 + 3)
    expect(slides[2]).toContain('Long table (continued)')
    expect(slides[3]).toContain('Person 30')
  })

  it('escapes hostile text in slide and chart XML', async () => {
    const evil = 'A & B <script>"x"</script>'
    const doc = sample({
      title: evil,
      blocks: [
        { kind: 'chart', id: 'c', title: evil, chart: 'bar', labels: [evil, 'b'], series: [{ name: evil, values: [1, 2] }] },
        { kind: 'table', id: 't', title: evil, columns: [{ label: evil }], rows: [[{ text: evil }]] },
        { kind: 'findings', id: 'f', items: [{ severity: 'low', title: evil, evidence: evil, suggestion: evil }] },
      ],
    })
    const { slides, charts } = await open(await docToPptx({ doc, business: { ...business, name: evil }, language: 'en', generatedAt: at }))
    for (const [label, xml] of [['slides', slides.join('\n')], ['charts', charts.join('\n')]] as const) {
      expect(xml, label).not.toContain('<script>')
      expect(xml, label).toContain('&lt;script&gt;')
      expect(xml, label).toContain('A &amp; B')
    }
  })

  it('an empty doc (no blocks) still builds: the cover alone', async () => {
    const { zip, slides } = await open(await docToPptx({ doc: sample({ blocks: [], notes: [] }), business: { ...business, brandColor: null }, language: 'en', generatedAt: at }))
    expect(slides).toHaveLength(1)
    expect(Object.values(zip.files).filter((f) => f.dir)).toEqual([])
  })

  it('a chart with no data says so instead of drawing an empty chart', async () => {
    const doc = sample({ notes: [], blocks: [{ kind: 'chart', id: 'c', title: 'Empty', chart: 'barline', labels: [], series: [] }] })
    const { slides, charts } = await open(await docToPptx({ doc, business, language: 'en', generatedAt: at }))
    expect(charts).toHaveLength(0)
    expect(slides[1]).toContain('Nothing in this period.')
  })
})
