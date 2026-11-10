import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/reports/pdf: the Leads report as a PDF file.
 *
 * Same door as the Excel download: supervisors and above with the Reports
 * page, never an agent. The team report (no person filter), the business
 * and language from the session's own account, a file name from dates only,
 * an audit entry without figures, and plain words on failure.
 */

const h = vi.hoisted(() => ({
  role: 'supervisor' as string,
  pageOk: true,
  built: [] as Array<Record<string, any>>,
  summaries: [] as Array<{ accountId: string; userId: string | null }>,
  audits: [] as Array<Record<string, any>>,
  buildFails: false,
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  const rank: Record<string, number> = { viewer: 1, agent: 2, supervisor: 3, admin: 4, owner: 5 }
  return {
    ForbiddenError,
    requireRole: (min: string) => {
      if ((rank[h.role] ?? 0) < (rank[min] ?? 99)) throw new ForbiddenError('This action requires a higher role')
      return Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: h.role })
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
  audit: (_c: unknown, entry: Record<string, any>) => { h.audits.push(entry); return Promise.resolve() },
}))
vi.mock('@/lib/reports/summary', () => ({
  buildSummary: (a: { accountId: string; userId: string | null }) => { h.summaries.push({ accountId: a.accountId, userId: a.userId }); return Promise.resolve({ scope: 'team' }) },
}))
vi.mock('@/lib/reports/reply-speed', () => ({ replySpeed: () => Promise.resolve(null) }))
vi.mock('@/lib/reports/pdf/leads-pdf', () => ({
  buildLeadsPdf: (input: Record<string, any>) => {
    h.built.push(input)
    if (h.buildFails) return Promise.reject(new Error('pdfkit exploded at /srv/app/node_modules/x.js:1'))
    return Promise.resolve(Buffer.from('%PDF-1.7 fake'))
  },
}))
vi.mock('@/lib/files/account-files', () => ({ readAccountFile: () => Promise.resolve(null) }))
vi.mock('@/lib/files/image-size', () => ({ imageProblem: () => null }))
vi.mock('@/lib/db', () => ({
  prisma: {
    account: { findUnique: () => Promise.resolve({ name: 'Account Name Ltd' }) },
    companyProfile: { findUnique: () => Promise.resolve({ display_name: 'Malabar Skills', city: 'Kozhikode' }) },
    accountReportProfile: { findUnique: () => Promise.resolve({ report_language: 'ml', tax_id: null, logo_file_id: null }) },
  },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/reports/pdf?${qs}`))

beforeEach(() => {
  h.role = 'supervisor'; h.pageOk = true; h.built = []; h.summaries = []; h.audits = []; h.buildFails = false
})

describe('GET /api/reports/pdf', () => {
  it('an agent gets no PDF, and nothing is read', async () => {
    h.role = 'agent'
    expect((await get('period=week')).status).toBe(403)
    expect(h.summaries).toHaveLength(0)
  })

  it('without the Reports page, no PDF', async () => {
    h.pageOk = false
    expect((await get('period=week')).status).toBe(403)
    expect(h.built).toHaveLength(0)
  })

  it('a supervisor gets the team report of their own account, in its language, named by dates, audited without figures', async () => {
    const res = await get('period=custom&from=2026-11-01&to=2026-11-09&accountId=other')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="leads-2026-11-01-to-2026-11-09.pdf"')
    expect(h.summaries).toEqual([{ accountId: 'acc-1', userId: null }])
    expect(h.built[0]).toMatchObject({ language: 'ml', business: { name: 'Malabar Skills' } })
    expect(h.audits[0]).toMatchObject({ action: 'export.downloaded', meta: { format: 'pdf' } })
    expect(JSON.stringify(h.audits[0])).not.toContain('120000')
  })

  it('a wrong period is a plain 400; a failed build is plain words, never a stack trace', async () => {
    expect((await get('period=year')).status).toBe(400)
    h.buildFails = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('period=week')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Could not build the PDF right now. Try again in a minute.')
    expect(JSON.stringify(body)).not.toContain('node_modules')
  })
})
