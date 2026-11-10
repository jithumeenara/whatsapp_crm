import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { assembleSpending, type SpendingRows } from './spending-assemble'
import { buildSpendingWorkbook, MAX_SHEET_ROWS, SPENDING_SHEETS, type SpendingWorkbookInput } from './spending-excel'

/**
 * The Spending report as an Excel workbook, for people who want to work on the
 * figures. Rules: text that came from people (names, teams, number labels, the
 * business name) never becomes a formula; amounts stay numbers; money in
 * different currencies is never added, each currency has its own row; a
 * sheet is capped so a huge period cannot exhaust the server.
 */

const rows = (over: Partial<SpendingRows> = {}): SpendingRows => ({
  waCategory: [
    { category: 'marketing', type: 'regular', currency: 'INR', n: 100, amount: 86.31, unpriced: 0 },
    { category: 'marketing', type: 'regular', currency: 'USD', n: 4, amount: 1.5, unpriced: 0 },
    { category: 'utility', type: 'free_customer_service', currency: 'INR', n: 30, amount: 0, unpriced: 0 },
  ],
  waNumber: [{ id: 'n1', currency: 'INR', n: 134, amount: 86.31 }],
  waPerson: [{ userId: 'u1', senderType: 'agent', currency: 'INR', n: 100, amount: 60 }],
  waDay: [{ day: '2026-11-01', currency: 'INR', amount: 40 }, { day: '2026-11-02', currency: 'INR', amount: 46.31 }],
  waPending: 0,
  aiFeature: [{ feature: 'chat_customer', calls: 40, costUsd: 0.8 }],
  aiChannel: [{ channel: 'whatsapp', calls: 40, costUsd: 0.8 }],
  aiPerson: [{ userId: 'u1', calls: 10, costUsd: 0.2 }, { userId: null, calls: 30, costUsd: 0.6 }],
  aiDay: [{ day: '2026-11-01', costUsd: 0.8 }],
  numbers: { n1: 'Admissions' },
  people: { u1: 'Asha' },
  teams: { u1: 'Sales' },
  ads: { connected: true, spend: 1500, currency: 'INR', clicks: 120, impressions: 9000, error: null },
  leads: 40, wonDeals: 6, businessCurrency: 'INR', usdRate: 88.5,
  ...over,
})

const input = (over: Partial<SpendingRows> = {}, extra: Partial<SpendingWorkbookInput> = {}): SpendingWorkbookInput => ({
  report: {
    ...assembleSpending(rows(over)),
    period: { firstDay: '2026-11-01', lastDay: '2026-11-09', partial: true, timeZone: 'Asia/Kolkata' },
    warnings: [],
  },
  business: { name: 'Malabar Skills Academy', taxId: '29AAAAA0000A1Z5' },
  generatedAt: new Date('2026-11-09T10:00:00Z'),
  timeZone: 'Asia/Kolkata',
  ...extra,
})

/** Write it out and read it back, as a person opening the file would. */
async function roundTrip(i: SpendingWorkbookInput): Promise<ExcelJS.Workbook> {
  const buffer = await buildSpendingWorkbook(i).xlsx.writeBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)
  return wb
}

const cells = (ws: ExcelJS.Worksheet): unknown[][] => {
  const out: unknown[][] = []
  ws.eachRow((row) => out.push((row.values as unknown[]).slice(1)))
  return out
}

describe('buildSpendingWorkbook', () => {
  it('has every sheet, in order, each with its heading row', async () => {
    const wb = await roundTrip(input())
    expect(wb.worksheets.map((w) => w.name)).toEqual([...SPENDING_SHEETS])
    for (const ws of wb.worksheets) expect(ws.rowCount, ws.name).toBeGreaterThanOrEqual(1)
  })

  it('puts the business, the period and the headline figures on the first sheet', async () => {
    const wb = await roundTrip(input())
    const text = JSON.stringify(cells(wb.getWorksheet('Summary')!))
    expect(text).toContain('Malabar Skills Academy')
    expect(text).toContain('2026-11-01')
    expect(text).toContain('2026-11-09')
    expect(text).toContain('29AAAAA0000A1Z5')
    expect(text).toContain('Total spend')
  })

  it('keeps amounts as numbers, not text, so they can be summed and charted', async () => {
    const wb = await roundTrip(input())
    const category = cells(wb.getWorksheet('WhatsApp by category')!)
    const marketingInr = category.find((r) => r[0] === 'Marketing' && r.includes('INR'))!
    expect(marketingInr.some((c) => c === 86.31)).toBe(true)
    // 100 rupee-priced and 4 dollar-priced messages are one category: 104, written once.
    expect(marketingInr.some((c) => c === 104)).toBe(true)
    for (const r of category.slice(1)) for (const c of r) expect(typeof c === 'string' && /^[\d,.]+$/.test(c)).toBe(false)
  })

  it('never adds currencies: each has its own row and the count is not repeated', async () => {
    const wb = await roundTrip(input())
    const category = cells(wb.getWorksheet('WhatsApp by category')!)
    const marketing = category.filter((r) => r[0] === 'Marketing' || (r[0] == null && r.includes('USD')))
    const currencies = marketing.map((r) => r.find((c) => c === 'INR' || c === 'USD'))
    expect(currencies.sort()).toEqual(['INR', 'USD'])
    // 100 + 4 messages appear once each, never 100 twice.
    const counts = marketing.flatMap((r) => r.filter((c) => c === 100 || c === 104 || c === 4))
    expect(counts).toContain(104)
    expect(counts.filter((c) => c === 104)).toHaveLength(1)
  })

  it('never lets a name become a formula, wherever it appears', async () => {
    const evil = ['=HYPERLINK("http://evil","x")', '+cmd|calc', '@SUM(1+1)', '-2+3']
    const wb = await roundTrip(
      input(
        {
          people: { u1: evil[0] },
          teams: { u1: evil[1] },
          numbers: { n1: evil[2] },
        },
        { business: { name: evil[3], taxId: '=1+1' } },
      ),
    )
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          const v = cell.value
          if (typeof v === 'string' && /^[=+\-@]/.test(v)) throw new Error(`${ws.name}: "${v}" starts like a formula`)
          expect(typeof v === 'object' && v !== null && 'formula' in (v as object)).toBe(false)
        })
      })
    }
    const text = JSON.stringify(wb.worksheets.map((w) => cells(w)))
    expect(text).toContain("'=HYPERLINK")
    expect(text).toContain("'@SUM")
  })

  it('writes dates as text in the business zone, not the server\'s', async () => {
    const wb = await roundTrip(input())
    const text = JSON.stringify(cells(wb.getWorksheet('Summary')!))
    expect(text).toContain('2026-11-09 15:30') // 10:00 UTC is 15:30 in Kolkata
  })

  it('makes a valid workbook for an empty period', async () => {
    const empty = {
      waCategory: [], waNumber: [], waPerson: [], waDay: [], aiFeature: [], aiChannel: [], aiPerson: [], aiDay: [],
      ads: { connected: false, spend: null, currency: null, clicks: 0, impressions: 0, error: null }, leads: 0, wonDeals: 0,
    }
    const wb = await roundTrip(input(empty))
    expect(wb.worksheets).toHaveLength(SPENDING_SHEETS.length)
    expect(JSON.stringify(cells(wb.getWorksheet('WhatsApp by number')!))).toContain('Nothing in this period')
  })

  it('caps a sheet, and says so, so a huge period cannot exhaust the server', async () => {
    const many = Array.from({ length: MAX_SHEET_ROWS + 500 }, (_, i) => ({ id: `n${i}`, currency: 'INR', n: 1, amount: 1 }))
    const names = Object.fromEntries(many.map((m) => [m.id, `Number ${m.id}`]))
    const wb = await roundTrip(input({ waNumber: many, numbers: names }))
    const ws = wb.getWorksheet('WhatsApp by number')!
    expect(ws.rowCount).toBeLessThanOrEqual(MAX_SHEET_ROWS + 3)
    expect(JSON.stringify(cells(ws))).toMatch(/500 more/)
  })

  it('carries no customer names or numbers: only the business\'s own people', async () => {
    const wb = await roundTrip(input())
    const text = JSON.stringify(wb.worksheets.map((w) => cells(w)))
    expect(text).not.toMatch(/\+?91\d{10}/)
    expect(text).toContain('Asha')
  })
})
