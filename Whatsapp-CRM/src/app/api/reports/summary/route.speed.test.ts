import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Reply speed × win on the report: an agent's numbers come from their own
 * leads only, whatever they ask for; the team view is for supervisors and
 * up. If the section fails, the rest of the report still loads.
 */

const h = vi.hoisted(() => ({ role: 'agent', speedCalls: [] as Array<{ userId: string | null; accountId: string }>, speedFails: false }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'acc', userId: 'me', role: h.role }), assertPageAccess: () => {} }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/reports/summary', () => ({
  buildSummary: async (a: { userId: string | null }) => {
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
vi.mock('@/lib/reports/reply-speed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/reports/reply-speed')>('@/lib/reports/reply-speed')
  return {
    ...actual,
    replySpeed: async (a: { userId: string | null; accountId: string }) => {
      h.speedCalls.push({ userId: a.userId, accountId: a.accountId })
      if (h.speedFails) throw new Error('db down')
      return { countedSince: '2026-10-01T00:00:00.000Z', rows: actual.speedRows([{ bucket: 'min5', leads: 12, won: 3 }]) }
    },
  }
})

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/reports/summary?${qs}`))

beforeEach(() => { h.role = 'agent'; h.speedCalls = []; h.speedFails = false })

describe('reply speed on the report', () => {
  it('an agent gets speed numbers from their own leads only, even when asking for more', async () => {
    const res = await get('period=week&userId=someone-else&scope=team')
    expect(res.status).toBe(200)
    expect(h.speedCalls).toEqual([{ userId: 'me', accountId: 'acc' }])
    const body = await res.json()
    expect(body.speed.rows.find((r: { bucket: string }) => r.bucket === 'min5')).toMatchObject({ leads: 12, won: 3, winRate: 25 })
  })

  it('a supervisor gets the team', async () => {
    h.role = 'supervisor'
    await get('period=week')
    expect(h.speedCalls).toEqual([{ userId: null, accountId: 'acc' }])
  })

  it('a failing speed section does not break the report', async () => {
    h.speedFails = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('period=week')
    expect(res.status).toBe(200)
    expect((await res.json()).speed).toBeNull()
  })
})
