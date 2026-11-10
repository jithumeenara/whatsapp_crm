import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { assembleSpending } from '@/lib/reports/spending-assemble'

/**
 * GET /api/reports/spending/export: the Spending report as an Excel file.
 *
 * Same door as the screen and the PDF: supervisors and above with the Reports
 * page, never an agent. The file name is made of dates only, the download is
 * audited without its amounts, and a failure is plain words.
 */

const h = vi.hoisted(() => ({
  role: 'supervisor' as string,
  pageOk: true,
  userId: 'u1',
  loads: [] as Array<Record<string, any>>,
  audits: [] as Array<Record<string, any>>,
  loadFails: false,
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  const rank: Record<string, number> = { viewer: 1, agent: 2, supervisor: 3, admin: 4, owner: 5 }
  return {
    ForbiddenError,
    requireRole: (min: string) => {
      if ((rank[h.role] ?? 0) < (rank[min] ?? 99)) throw new ForbiddenError('This action requires a higher role')
      return Promise.resolve({ userId: h.userId, accountId: 'acc-1', role: h.role })
    },
    assertPageAccess: () => {
      if (!h.pageOk) throw new ForbiddenError('No access to this section')
    },
    toErrorResponse: (e: any) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/audit', () => ({
  auditCtx: () => ({}),
  audit: (_c: unknown, entry: Record<string, any>) => {
    h.audits.push(entry)
    return Promise.resolve()
  },
}))
vi.mock('@/lib/reports/spending', () => ({
  loadSpending: (a: Record<string, any>) => {
    h.loads.push(a)
    if (h.loadFails) return Promise.reject(new Error('relation "whatsapp_message_costs" does not exist at /srv/app'))
    const report = assembleSpending({
      waCategory: [{ category: 'marketing', type: 'regular', currency: 'INR', n: 3, amount: 123.45, unpriced: 0 }],
      waNumber: [], waPerson: [], waDay: [], waPending: 0, aiFeature: [], aiChannel: [], aiPerson: [], aiDay: [],
      numbers: {}, people: {}, teams: {},
      ads: { connected: false, spend: null, currency: null, clicks: 0, impressions: 0, error: null },
      leads: 0, wonDeals: 0, businessCurrency: 'INR', usdRate: 88.5,
    })
    return Promise.resolve({ ...report, warnings: [] })
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    account: { findUnique: () => Promise.resolve({ name: 'Account Name Ltd' }) },
    companyProfile: { findUnique: () => Promise.resolve({ display_name: 'Malabar Skills Academy', legal_name: null }) },
    accountReportProfile: { findUnique: () => Promise.resolve({ tax_id: 'GSTIN123' }) },
  },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/reports/spending/export?${qs}`))

beforeEach(() => {
  h.role = 'supervisor'
  h.pageOk = true
  h.userId = `u-${Math.random()}`
  h.loads = []
  h.audits = []
  h.loadFails = false
})

describe('GET /api/reports/spending/export', () => {
  it('is closed to agents and viewers, and to a supervisor without the Reports page', async () => {
    for (const role of ['viewer', 'agent']) {
      h.role = role
      expect((await get('period=month')).status).toBe(403)
    }
    h.role = 'supervisor'
    h.pageOk = false
    expect((await get('period=month')).status).toBe(403)
    expect(h.loads).toHaveLength(0)
  })

  it('answers with a real workbook, kept out of caches, with a file name made of dates only', async () => {
    const res = await get('period=custom&from=2026-11-01&to=2026-11-09')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="spending-2026-11-01-to-2026-11-09.xlsx"')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    expect(wb.worksheets[0].name).toBe('Summary')
    expect(JSON.stringify(wb.worksheets[0].getSheetValues())).toContain('Malabar Skills Academy')
  })

  it('reads only this business, whatever the query says', async () => {
    await get('period=week&accountId=other&account_id=other')
    expect(h.loads[0].accountId).toBe('acc-1')
  })

  it('is audited with its format and days, never its amounts', async () => {
    await get('period=month')
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ action: 'export.downloaded', meta: { format: 'xlsx' } })
    expect(JSON.stringify(h.audits)).not.toContain('123.45')
  })

  it('answers a bad period in plain words', async () => {
    expect((await get('period=forever')).status).toBe(400)
    expect((await get('period=custom&from=2026-02-01&to=2025-01-01')).status).toBe(400)
  })

  it('turns away the eleventh download in a minute from one person', async () => {
    let last = 200
    for (let i = 0; i < 11; i++) last = (await get('period=month')).status
    expect(last).toBe(429)
  })

  it('says plainly that it could not be prepared, without leaking the error', async () => {
    h.loadFails = true
    const res = await get('period=month')
    expect(res.status).toBe(500)
    const body = JSON.stringify(await res.json())
    expect(body).toMatch(/could not/i)
    expect(body).not.toContain('/srv/app')
    expect(body).not.toContain('whatsapp_message_costs')
  })
})
