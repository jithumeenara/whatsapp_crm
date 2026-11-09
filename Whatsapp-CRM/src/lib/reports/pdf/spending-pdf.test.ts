import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { assembleSpending, type SpendingRows } from '../spending-assemble'
import { REPORT_LANGUAGES } from '@/lib/countries'
import { buildSpendingPdf, type PdfBusiness } from './spending-pdf'

/**
 * The Spending report as a PDF: a header with the business's name, address,
 * tax number and logo; the figures; and on EVERY page the CRM's name and
 * "Page X of Y". Built in memory, in any of the languages Settings offers.
 */

const rows = (over: Partial<SpendingRows> = {}): SpendingRows => ({
  waCategory: [
    { category: 'marketing', type: 'regular', currency: 'INR', n: 100, amount: 86.31, unpriced: 0 },
    { category: 'utility', type: 'regular', currency: 'INR', n: 50, amount: 5.75, unpriced: 0 },
    { category: 'utility', type: 'free_customer_service', currency: 'INR', n: 30, amount: 0, unpriced: 0 },
  ],
  waNumber: [{ id: 'n1', currency: 'INR', n: 180, amount: 92.06 }],
  waPerson: [
    { userId: 'u1', senderType: 'agent', currency: 'INR', n: 120, amount: 60 },
    { userId: null, senderType: 'bot', currency: 'INR', n: 60, amount: 32.06 },
  ],
  waDay: [{ day: '2026-11-01', currency: 'INR', amount: 40 }, { day: '2026-11-02', currency: 'INR', amount: 52.06 }],
  waPending: 0,
  aiFeature: [{ feature: 'chat_customer', calls: 40, costUsd: 0.8 }, { feature: 'embedding', calls: 3, costUsd: 0.1 }],
  aiChannel: [{ channel: 'whatsapp', calls: 43, costUsd: 0.9 }],
  aiPerson: [{ userId: 'u1', calls: 10, costUsd: 0.2 }, { userId: null, calls: 33, costUsd: 0.7 }],
  aiDay: [{ day: '2026-11-01', costUsd: 0.4 }, { day: '2026-11-02', costUsd: 0.5 }],
  numbers: { n1: 'Admissions' },
  people: { u1: 'Asha' },
  teams: { u1: 'Sales' },
  ads: { connected: true, spend: 1500, currency: 'INR', clicks: 120, impressions: 9000, error: null },
  leads: 40,
  wonDeals: 6,
  businessCurrency: 'INR',
  usdRate: 88.5,
  ...over,
})

const report = (over: Partial<SpendingRows> = {}) => ({
  ...assembleSpending(rows(over)),
  period: { kind: 'month' as const, firstDay: '2026-11-01', lastDay: '2026-11-09', partial: true, timeZone: 'Asia/Kolkata' },
  warnings: [] as string[],
})

const business: PdfBusiness = {
  name: 'Malabar Skills Academy',
  lines: ['12/345 Mavoor Road, Kozhikode, Kerala', 'Phone +91 495 000 0000 · hello@example.com'],
  taxId: '32AABCU9603R1ZX',
  logo: null,
}

/** A real 1x1 PNG. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function pagesOf(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf))
  const { text } = await extractText(doc, { mergePages: false })
  return Array.isArray(text) ? text : [text]
}

const build = (over: Partial<Parameters<typeof buildSpendingPdf>[0]> = {}) =>
  buildSpendingPdf({ report: report(), business, language: 'en', generatedAt: new Date('2026-11-09T10:00:00Z'), timeZone: 'Asia/Kolkata', ...over })

describe('buildSpendingPdf', () => {
  it('makes a real PDF with the business header, the figures and the CRM name in the footer', async () => {
    const pdf = await build()
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const [first] = await pagesOf(pdf)
    expect(first).toContain('Malabar Skills Academy')
    expect(first).toContain('Mavoor Road')
    expect(first).toContain('32AABCU9603R1ZX')
    expect(first).toContain('Spending report')
    expect(first).toContain('Total spend')
    expect(first).toContain('Lead Magnet CRM')
    expect(first).toMatch(/Page 1 of \d+/)
  })

  it('prints the amounts with their paise and the right currency', async () => {
    const [first] = await pagesOf(await build())
    expect(first.replace(/\s/g, ' ')).toContain('₹86.31')
  })

  it('puts the CRM name and "Page X of Y" on every page, however many there are', async () => {
    const many = rows({
      waNumber: Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, currency: 'INR', n: 1, amount: 1 })),
      numbers: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`n${i}`, `Number ${i}`])),
    })
    const pdf = await build({ report: { ...assembleSpending(many), period: report().period, warnings: [] } })
    const pages = await pagesOf(pdf)
    expect(pages.length).toBeGreaterThan(2)
    pages.forEach((p, i) => {
      expect(p, `page ${i + 1}`).toContain('Lead Magnet CRM')
      expect(p, `page ${i + 1}`).toContain(`Page ${i + 1} of ${pages.length}`)
    })
  })

  it('repeats the table heading on a continuation page', async () => {
    const many = rows({
      waNumber: Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, currency: 'INR', n: 1, amount: 1 })),
      numbers: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`n${i}`, `Number ${i}`])),
    })
    const pdf = await build({ report: { ...assembleSpending(many), period: report().period, warnings: [] } })
    const pages = await pagesOf(pdf)
    expect(pages[1]).toContain('Messages')
  })

  it('is written in every language Settings offers, without throwing', async () => {
    for (const l of REPORT_LANGUAGES) {
      const pdf = await build({ language: l.code })
      expect(pdf.length, l.code).toBeGreaterThan(5000)
      const [first] = await pagesOf(pdf)
      expect(first, l.code).toContain('Lead Magnet CRM')
    }
  })

  it('falls back to English for a language it does not know', async () => {
    const [first] = await pagesOf(await build({ language: 'xx' }))
    expect(first).toContain('Spending report')
  })

  it('embeds a logo, and a broken logo costs the report its logo, never the report', async () => {
    const withLogo = await build({ business: { ...business, logo: { bytes: PNG_1x1, mime: 'image/png' } } })
    expect(withLogo.length).toBeGreaterThan((await build()).length)
    const broken = await build({ business: { ...business, logo: { bytes: Buffer.from('not an image'), mime: 'image/png' } } })
    const [first] = await pagesOf(broken)
    expect(first).toContain('Malabar Skills Academy')
  })

  it('survives a PNG with a fine header and corrupt data, which crashes pdfkit if it is handed over', async () => {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(1, 0)
    ihdr.writeUInt32BE(1, 4)
    ihdr[8] = 8
    ihdr[9] = 6
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length)
      return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)])
    }
    const evil = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', Buffer.from('not zlib data')), chunk('IEND', Buffer.alloc(0)),
    ])
    const pdf = await build({ business: { ...business, logo: { bytes: evil, mime: 'image/png' } } })
    const [first] = await pagesOf(pdf)
    expect(first).toContain('Malabar Skills Academy')
    expect(first).toContain('Lead Magnet CRM')
  })

  it('never drops the tax number, however many address lines there are', async () => {
    // Found in review: the tax number was the sixth header line and was cut silently.
    const lines = ['Line 1 address', 'Line 2 address', 'Line 3 address', 'Line 4 address', 'Line 5 address', 'Line 6 address']
    const [first] = await pagesOf(await build({ business: { ...business, lines } }))
    expect(first).toContain('32AABCU9603R1ZX')
    expect(first).toContain('Line 1 address')
  })

  it('never cuts an amount: every currency in a crowded cell is printed', async () => {
    const crowded = report({
      waNumber: [{ id: 'n1', currency: 'INR', n: 5, amount: 12345678.55 }, { id: 'n1', currency: 'USD', n: 5, amount: 99999.99 }, { id: 'n1', currency: 'EUR', n: 5, amount: 5.5 }, { id: 'n1', currency: 'GBP', n: 5, amount: 3.2 }],
      waCategory: [{ category: 'marketing', type: 'regular', currency: 'INR', n: 1, amount: 12345678.55, unpriced: 0 }, { category: 'marketing', type: 'regular', currency: 'USD', n: 1, amount: 99999.99, unpriced: 0 }, { category: 'marketing', type: 'regular', currency: 'EUR', n: 1, amount: 5.5, unpriced: 0 }, { category: 'marketing', type: 'regular', currency: 'GBP', n: 1, amount: 3.2, unpriced: 0 }],
    })
    const pages = await pagesOf(await build({ report: crowded }))
    const text = pages.join(' ').replace(/\s/g, '')
    expect(text).toContain('£3.20')
    expect(text).toContain('€5.50')
    expect(text).not.toContain('…')
  })

  it('is not slowed by absurdly long names (they once froze the server for minutes)', async () => {
    const evil = 'ആശ Kumar محمد '.repeat(300)
    const heavy = report({
      waPerson: [{ userId: 'u1', senderType: 'agent', currency: 'INR', n: 1, amount: 1 }],
      aiPerson: [{ userId: 'u1', calls: 1, costUsd: 0.1 }],
      people: { u1: evil }, teams: { u1: evil }, numbers: { n1: evil },
    })
    const t0 = performance.now()
    const pdf = await build({ report: heavy, business: { ...business, name: evil, lines: [evil] } })
    expect(performance.now() - t0).toBeLessThan(5000)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('labels the by-channel money column as money, not as messages', async () => {
    const pages = await pagesOf(await build())
    const text = pages.join(' ')
    const channel = text.slice(text.indexOf('By channel'), text.indexOf('AI by feature'))
    expect(channel).toContain('WhatsApp')
    expect(channel).not.toContain('Messages')
  })

  it('puts the estimate note where it cannot be left alone on a last page', async () => {
    const pages = await pagesOf(await build())
    const last = pages[pages.length - 1]
    // The note is up with the other notes, so the last page is never only that note.
    expect(pages[0]).toContain('estimate')
    expect(last.replace(/Lead Magnet CRM|Page \d+ of \d+/g, '').trim().length).toBeGreaterThan(60)
  })

  it('groups large counts and does not print a plural with a one', async () => {
    const big = report({ aiFeature: [{ feature: 'chat_customer', calls: 1234567, costUsd: 1 }], leads: 1, wonDeals: 1 })
    const [first] = await pagesOf(await build({ report: big }))
    expect(first).toContain('12,34,567')
    expect(first).not.toMatch(/\b1 (leads|calls|deals)/)
  })

  it('says so when a period has nothing in it, and still makes a valid report', async () => {
    const empty = { ...assembleSpending(rows({ waCategory: [], waNumber: [], waPerson: [], waDay: [], aiFeature: [], aiChannel: [], aiPerson: [], aiDay: [], ads: { connected: false, spend: null, currency: null, clicks: 0, impressions: 0, error: null }, leads: 0, wonDeals: 0 })), period: report().period, warnings: [] }
    const [first] = await pagesOf(await build({ report: empty }))
    expect(first).toContain('Nothing in this period')
  })

  it('carries no customer names or numbers: only the business\'s own people and teams', async () => {
    const [first] = await pagesOf(await build())
    expect(first).not.toMatch(/\+?91\d{10}/)
    expect(first).toContain('Asha')
  })

  it('handles a business name with line breaks, odd characters and great length', async () => {
    const pdf = await build({ business: { ...business, name: `Evil\nName =HYPERLINK("x") ${'long '.repeat(80)}`, lines: ['<script>alert(1)</script>'] } })
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
