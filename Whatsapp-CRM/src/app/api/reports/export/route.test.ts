import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The Excel export: supervisors and above only (an agent gets no export,
 * not even of their own numbers), refused before anything is read; a wrong
 * period is a plain 400; a download is audited with the period and kind
 * only, never the numbers.
 */

const h = vi.hoisted(() => ({
  role: 'supervisor',
  calls: [] as Array<{ userId: string | null }>,
  audits: [] as Array<{ action: string; meta?: Record<string, unknown> | null }>,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: Parameters<typeof hasMinRole>[1]) => {
      if (!hasMinRole(h.role as Parameters<typeof hasMinRole>[0], min)) throw new actual.ForbiddenError('no')
      return { accountId: 'acc', userId: 'me', role: h.role }
    },
    assertPageAccess: () => {},
  }
})
vi.mock('@/lib/audit', () => ({
  auditCtx: () => ({}),
  audit: async (_c: unknown, e: { action: string; meta?: Record<string, unknown> | null }) => {
    h.audits.push(e)
  },
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/reports/summary', () => ({
  buildSummary: async (a: { userId: string | null }) => {
    h.calls.push({ userId: a.userId })
    const leak = { count: 0, rows: [] }
    const none = { total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0 }
    return {
      generatedAt: '2026-11-07T09:00:00.000Z', scope: 'team', cohort: none, previousCohort: none, excluded: 0,
      wonInPeriod: 0, lostInPeriod: 0, previousWonInPeriod: 0,
      calls: { total: 0, connected: 0, previousTotal: 0, countedSince: null },
      revenue: [], previousRevenue: [], lostAmount: [], pipeline: [{ currency: 'INR', amount: 1500, deals: 1, withAmount: 1 }],
      pipelineByStage: [], wonWithoutDate: 0, bySource: [], byCategory: [], lostReasons: [],
      leaks: { neverContacted: leak, overdueFollowUps: leak, unassigned: leak, waitingChats: leak },
      leakHours: 24, agents: [], funnel: [],
    }
  },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/reports/export?${qs}`))

describe('GET /api/reports/export', () => {
  beforeEach(() => {
    h.calls = []
    h.audits = []
  })

  it('an agent or viewer is refused before anything is built', async () => {
    for (const role of ['agent', 'viewer']) {
      h.role = role
      expect((await get('period=week')).status).toBe(403)
    }
    expect(h.calls).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
  })

  it('a wrong period or date range is a plain 400', async () => {
    h.role = 'owner'
    expect((await get('period=year')).status).toBe(400)
    expect((await get('period=custom&from=2026-10-26&to=2026-10-13')).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('a supervisor gets the team report as an xlsx, audited without data', async () => {
    h.role = 'supervisor'
    const res = await get('period=custom&from=2026-10-01&to=2026-10-31&user=someone')
    expect(res.status).toBe(200)
    expect(h.calls).toEqual([{ userId: null }])
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="report-2026-10-01-to-2026-10-31.xlsx"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const bytes = new Uint8Array(await res.arrayBuffer())
    // An xlsx is a zip: "PK".
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b])
    expect(h.audits).toEqual([{
      action: 'export.downloaded',
      target: { type: 'report', label: 'Owner report' },
      meta: { format: 'xlsx', kind: 'custom', period: '2026-10-01 to 2026-10-31' },
    }])
  })
})
