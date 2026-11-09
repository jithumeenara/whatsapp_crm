import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/reports/spending/pdf: the Spending report as a PDF file.
 *
 * Same door as the screen: supervisors and above with the Reports page, never
 * an agent. The file name is built from dates only, the logo is read from the
 * business's own folder only, the download is audited without its amounts,
 * and a failure is plain words, never a stack trace.
 */

const h = vi.hoisted(() => ({
  role: 'supervisor' as string,
  pageOk: true,
  userId: 'u1',
  built: [] as Array<Record<string, any>>,
  audits: [] as Array<Record<string, any>>,
  readCalls: [] as Array<{ accountId: string; fileId: string }>,
  reportProfile: { logo_file_id: 'file-1', tax_id: 'GSTIN123', report_language: 'ml' } as null | Record<string, any>,
  buildFails: false,
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
  loadSpending: () => Promise.resolve({ totals: { combined: 123.45 }, warnings: [], businessCurrency: 'INR' }),
}))
vi.mock('@/lib/reports/pdf/spending-pdf', () => ({
  buildSpendingPdf: (input: Record<string, any>) => {
    h.built.push(input)
    if (h.buildFails) return Promise.reject(new Error('pdfkit exploded at /srv/app/node_modules/x.js:1'))
    return Promise.resolve(Buffer.from('%PDF-1.7 fake'))
  },
}))
vi.mock('@/lib/files/account-files', () => ({
  readAccountFile: (accountId: string, fileId: string) => {
    h.readCalls.push({ accountId, fileId })
    return Promise.resolve({ id: fileId, mime: 'image/png', bytes: Buffer.from('png'), name: 'logo', size: 3, url: '' })
  },
}))
vi.mock('@/lib/files/image-size', () => ({ imageProblem: () => null }))
vi.mock('@/lib/db', () => ({
  prisma: {
    account: { findUnique: () => Promise.resolve({ name: 'Account Name Ltd' }) },
    companyProfile: {
      findUnique: () =>
        Promise.resolve({
          display_name: 'Malabar Skills Academy', legal_name: null, address: '12 Mavoor Road', city: 'Kozhikode',
          state: 'Kerala', country: 'India', phone: '+91 495 000 0000', email: 'hello@example.com',
        }),
    },
    accountReportProfile: { findUnique: () => Promise.resolve(h.reportProfile) },
  },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/reports/spending/pdf?${qs}`))

beforeEach(() => {
  h.role = 'supervisor'
  h.pageOk = true
  h.userId = `u-${Math.random()}`
  h.built = []
  h.audits = []
  h.readCalls = []
  h.reportProfile = { logo_file_id: 'file-1', tax_id: 'GSTIN123', report_language: 'ml' }
  h.buildFails = false
})

describe('GET /api/reports/spending/pdf', () => {
  it('is closed to agents and viewers, and to a supervisor without the Reports page', async () => {
    for (const role of ['viewer', 'agent']) {
      h.role = role
      expect((await get('period=month')).status).toBe(403)
    }
    h.role = 'supervisor'
    h.pageOk = false
    expect((await get('period=month')).status).toBe(403)
    expect(h.built).toHaveLength(0)
  })

  it('answers with a PDF, kept out of caches, with a file name made of dates only', async () => {
    const res = await get('period=custom&from=2026-11-01&to=2026-11-09')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="spending-2026-11-01-to-2026-11-09\.pdf"$/)
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('writes the business header from the business\'s own details, in its chosen language', async () => {
    await get('period=month')
    const input = h.built[0]
    expect(input.language).toBe('ml')
    expect(input.business.name).toBe('Malabar Skills Academy')
    expect(input.business.taxId).toBe('GSTIN123')
    expect(input.business.lines.join(' ')).toContain('Mavoor Road')
    expect(input.business.lines.join(' ')).toContain('hello@example.com')
    expect(input.business.logo).toMatchObject({ mime: 'image/png' })
  })

  it('reads the logo from the business\'s own folder only', async () => {
    await get('period=month')
    expect(h.readCalls).toEqual([{ accountId: 'acc-1', fileId: 'file-1' }])
  })

  it('makes the report without a logo when there is none, in English when nothing was chosen', async () => {
    h.reportProfile = null
    const res = await get('period=month')
    expect(res.status).toBe(200)
    expect(h.built[0].business.logo).toBeNull()
    expect(h.built[0].language).toBe('en')
    expect(h.readCalls).toHaveLength(0)
  })

  it('is audited with its format and days, never its amounts', async () => {
    await get('period=month')
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ action: 'export.downloaded', meta: { format: 'pdf' } })
    expect(JSON.stringify(h.audits)).not.toContain('123.45')
  })

  it('answers a bad period in plain words', async () => {
    expect((await get('period=forever')).status).toBe(400)
    expect((await get('period=custom&from=2026-02-01&to=2025-01-01')).status).toBe(400)
  })

  it('turns away the seventh download in a minute from one person', async () => {
    let last = 200
    for (let i = 0; i < 7; i++) last = (await get('period=month')).status
    expect(last).toBe(429)
  })

  it('says plainly that it could not be built, without leaking the error', async () => {
    h.buildFails = true
    const res = await get('period=month')
    expect(res.status).toBe(500)
    const body = JSON.stringify(await res.json())
    expect(body).toMatch(/could not/i)
    expect(body).not.toContain('/srv/app')
    expect(body).not.toContain('pdfkit')
  })
})
