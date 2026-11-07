import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Who sees what: supervisors and above get the team; an agent or viewer
 * gets a report built from their own work only, whatever the request
 * asks for. A wrong period is a plain 400.
 */

const h = vi.hoisted(() => ({ role: 'agent', calls: [] as Array<{ userId: string | null }>, pageOk: true }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return {
    ...actual,
    requireRole: async () => ({ accountId: 'acc', userId: 'me', role: h.role }),
    assertPageAccess: () => {
      if (!h.pageOk) throw new actual.ForbiddenError('no')
    },
  }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/reports/summary', () => ({
  buildSummary: async (a: { userId: string | null }) => {
    h.calls.push({ userId: a.userId })
    const leak = { count: 0, rows: [] }
    return {
      scope: a.userId ? 'self' : 'team',
      cohort: { total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0 },
      wonInPeriod: 0, calls: { total: 0 }, revenue: [],
      leaks: { neverContacted: leak, overdueFollowUps: leak, unassigned: leak, waitingChats: leak },
      leakHours: 24,
    }
  },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/reports/summary?${qs}`))

describe('GET /api/reports/summary', () => {
  beforeEach(() => {
    h.calls = []
    h.pageOk = true
  })

  it('an agent gets only their own report, even when asking for more', async () => {
    h.role = 'agent'
    const res = await get('period=week&user=someone-else&scope=team')
    expect(res.status).toBe(200)
    expect(h.calls).toEqual([{ userId: 'me' }])
    expect((await res.json()).summary.scope).toBe('self')
  })

  it('a viewer given the page is also limited to themselves', async () => {
    h.role = 'viewer'
    await get('period=today')
    expect(h.calls).toEqual([{ userId: 'me' }])
  })

  it('supervisors, admins and owners see the team', async () => {
    for (const role of ['supervisor', 'admin', 'owner']) {
      h.role = role
      h.calls = []
      await get('period=month')
      expect(h.calls).toEqual([{ userId: null }])
    }
  })

  it('someone without the page is refused before anything is read', async () => {
    h.role = 'agent'
    h.pageOk = false
    expect((await get('period=week')).status).toBe(403)
    expect(h.calls).toHaveLength(0)
  })

  it('a wrong period or date range is a plain 400', async () => {
    h.role = 'owner'
    expect((await get('period=year')).status).toBe(400)
    expect((await get('period=custom&from=2026-10-26&to=2026-10-13')).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })
})
