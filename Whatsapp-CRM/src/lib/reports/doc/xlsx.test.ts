import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { docToXlsx, numFmtFor, sheetNamer } from './xlsx'
import type { DocBusiness, ReportDoc } from './types'

/**
 * Any ReportDoc as a workbook: a Summary sheet, a sheet per table and chart,
 * numbers kept numeric with money formatted, nothing that runs as a formula,
 * and sheet names Excel accepts.
 */

function sample(over: Partial<ReportDoc> = {}): ReportDoc {
  return {
    key: 'leads',
    title: 'Leads report',
    headline: 'Leads rose 35% to 142.',
    period: { kind: 'week', firstDay: '2026-10-01', lastDay: '2026-10-07', timeZone: 'Asia/Kolkata', previous: { firstDay: '2026-09-24', lastDay: '2026-09-30' } },
    scope: 'team',
    generatedAt: '2026-10-08T04:00:00.000Z',
    notes: ['Data since 1 September.'],
    blocks: [
      {
        kind: 'kpis', id: 'k', items: [
          { label: 'Leads', value: '142', compare: { now: 142, before: 105, higherIsBetter: true, fmt: { kind: 'count' } } },
          { label: 'Revenue', value: '₹12,50,000', compare: { now: 1250000, before: null, higherIsBetter: true, fmt: { kind: 'money', currency: 'INR' } } },
          { label: '=cmd|calc', value: '7', sub: 'hostile label' },
        ],
      },
      { kind: 'chart', id: 'c1', title: 'Leads by day', chart: 'bar', labels: ['1 Oct', '2 Oct', '3 Oct'], series: [{ name: 'Leads', values: [12, 25, 18], previous: [10, 14, 15] }] },
      { kind: 'chart', id: 'c2', title: 'Spend: by day / week', chart: 'barline', labels: ['1 Oct', '2 Oct'], series: [{ name: 'Spend', values: [1000, 1250], fmt: { kind: 'money', currency: 'INR' } }, { name: 'Conversations', values: [10, 14], kind: 'line', axis: 'right' }] },
      {
        kind: 'table', id: 't1', title: 'Team',
        columns: [{ label: 'Team member' }, { label: 'Calls', fmt: { kind: 'count' } }, { label: 'Revenue', fmt: { kind: 'money', currency: 'INR' } }],
        rows: [
          [{ text: 'Parvathy' }, { text: '60', value: 60 }, { text: '₹5,00,000', value: 500000 }],
          [{ text: '=HYPERLINK("http://x","y")' }, { text: '1', value: 1 }, { text: '₹0', value: 0 }],
        ],
        total: [{ text: 'Team total' }, { text: '61', value: 61 }, { text: '₹5,00,000', value: 500000 }],
      },
      { kind: 'table', id: 't2', title: 'Team', columns: [{ label: 'Stage' }], rows: [] },
      { kind: 'text', id: 'x', style: 'bullets', lines: ['One.', 'Two.'] },
      { kind: 'findings', id: 'f', items: [{ severity: 'high', title: 'Slow replies', evidence: '48 min on Sunday.', suggestion: 'Add a Sunday rota.', byAi: true }] },
    ],
    ...over,
  }
}

const business: DocBusiness = { name: 'SP Medifort Hospital', lines: ['Kerala'], taxId: '32AAAAA0000A1Z5', logo: null, brandColor: null }
const at = new Date('2026-10-08T04:00:00Z')

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  return wb
}
const allText = (ws: ExcelJS.Worksheet) => {
  const out: string[] = []
  ws.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? ''))))
  return out
}

describe('docToXlsx', () => {
  it('has the Summary sheet plus one sheet per table and chart, with valid unique names', async () => {
    const wb = await load(await docToXlsx({ doc: sample(), business, language: 'en', generatedAt: at }))
    const names = wb.worksheets.map((w) => w.name)
    expect(names[0]).toBe('Summary')
    expect(names).toHaveLength(1 + 2 + 2)
    expect(names).toContain('Leads by day')
    expect(names).toContain('Team')
    expect(names).toContain('Team (2)')
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31)
      expect(n).not.toMatch(/[[\]:*?/\\]/)
    }
    const summary = allText(wb.getWorksheet('Summary')!)
    for (const s of ['SP Medifort Hospital', 'Leads report', 'Leads rose 35% to 142.', 'Leads', 'Data since 1 September.', 'Slow replies']) expect(summary, s).toContain(s)
  })

  it('keeps numbers numeric and gives money a currency format', async () => {
    const wb = await load(await docToXlsx({ doc: sample(), business, language: 'en', generatedAt: at }))
    const team = wb.getWorksheet('Team')!
    expect(team.getRow(1).getCell(1).value).toBe('Team member')
    expect(team.getRow(2).getCell(2).value).toBe(60)
    expect(team.getRow(2).getCell(3).value).toBe(500000)
    expect(team.getRow(2).getCell(3).numFmt).toContain('₹')
    expect(team.getRow(4).getCell(1).value).toBe('Team total')
    expect(team.getRow(4).font?.bold).toBe(true)
    expect(team.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })

    const chart = wb.getWorksheet('Leads by day')!
    expect(chart.getRow(1).values).toEqual([undefined, 'Item', 'Leads', 'Leads (before)'])
    expect(chart.getRow(2).values).toEqual([undefined, '1 Oct', 12, 10])

    const summary = wb.getWorksheet('Summary')!
    let leadsRow: ExcelJS.Row | undefined
    summary.eachRow((r) => { if (r.getCell(1).value === 'Leads') leadsRow = r })
    expect(leadsRow?.getCell(2).value).toBe(142)
    expect(leadsRow?.getCell(3).value).toBe(105)
    expect(leadsRow?.getCell(4).value).toBeCloseTo(37 / 105, 5)
  })

  it('neutralises a cell that starts with "="', async () => {
    const wb = await load(await docToXlsx({ doc: sample(), business, language: 'en', generatedAt: at }))
    const team = wb.getWorksheet('Team')!
    expect(team.getRow(3).getCell(1).value).toBe(`'=HYPERLINK("http://x","y")`)
    expect(typeof team.getRow(3).getCell(1).value).toBe('string')
    expect(allText(wb.getWorksheet('Summary')!)).toContain(`'=cmd|calc`)
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => expect(c.formula).toBeFalsy())))
  })

  it('an empty doc (no blocks) still builds, with only the Summary', async () => {
    const wb = await load(await docToXlsx({ doc: sample({ blocks: [], notes: undefined, headline: undefined }), business: { ...business, lines: [], taxId: null }, language: 'en', generatedAt: at }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary'])
  })
})

describe('helpers', () => {
  it('sheet names: no forbidden characters, at most 31, unique ignoring case, never History', () => {
    const name = sheetNamer()
    expect(name('Summary')).toBe('Summary')
    expect(name('summary')).toBe('summary (2)')
    expect(name('a[b]:c*d?e/f\\g')).toBe('a b c d e f g')
    const long = name('x'.repeat(50))
    expect(long).toHaveLength(31)
    expect(name('x'.repeat(50))).toBe(`${'x'.repeat(27)} (2)`)
    expect(name("'quoted'")).toBe('quoted')
    expect(name('')).toBe('Sheet')
    expect(name('History')).toBe('History sheet')
  })

  it('number formats', () => {
    expect(numFmtFor({ kind: 'money', currency: 'INR' })).toBe('"₹"#,##0.00')
    expect(numFmtFor({ kind: 'percent', digits: 1 })).toBe('0.0"%"')
    expect(numFmtFor({ kind: 'count' })).toBe('#,##0')
    expect(numFmtFor({ kind: 'text' })).toBeUndefined()
  })
})
