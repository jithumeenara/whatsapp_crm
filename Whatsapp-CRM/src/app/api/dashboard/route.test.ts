import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Who the dashboard numbers belong to. Agents, viewers and anybody whose
 * profile says "assigned only" get their own work; only an unflagged
 * supervisor or above gets the account, and only they read message
 * previews. A person without the Dashboard page is refused outright.
 */

const h = vi.hoisted(() => ({
  role: 'agent',
  flag: false,
  pageOk: true,
  metrics: [] as Array<string | null>,
  activity: [] as Array<{ withDetail: boolean; agentId: string | null }>,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findUnique: async () => ({ restrict_to_assigned: h.flag }),
    },
  },
}))
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
vi.mock('@/lib/dashboard/queries', () => ({
  loadMetrics: async (_a: string, agentId: string | null) => {
    h.metrics.push(agentId)
    return {}
  },
  loadConversationsSeries: async () => [],
  loadResponseTime: async () => ({}),
  loadActivity: async (_a: string, _l: number, withDetail: boolean, agentId: string | null) => {
    h.activity.push({ withDetail, agentId })
    return []
  },
  loadCRMStats: async () => ({}),
  loadSparks: async () => ({}),
  loadNewLeads: async () => 0,
}))

import { GET } from './route'

const get = (qs = 'section=overview') => GET(new NextRequest(`http://x/api/dashboard?${qs}`))

describe('GET /api/dashboard scope', () => {
  beforeEach(() => {
    h.metrics = []
    h.activity = []
    h.flag = false
    h.pageOk = true
  })

  it('an agent gets their own scope and no previews', async () => {
    h.role = 'agent'
    await get()
    expect(h.metrics).toEqual(['me'])
    expect(h.activity).toEqual([{ withDetail: false, agentId: 'me' }])
  })

  it('a viewer gets their own scope and no message previews', async () => {
    h.role = 'viewer'
    await get()
    expect(h.metrics).toEqual(['me'])
    expect(h.activity).toEqual([{ withDetail: false, agentId: 'me' }])
  })

  it('a supervisor with "assigned only" on gets their own scope and no previews', async () => {
    h.role = 'supervisor'
    h.flag = true
    await get()
    expect(h.metrics).toEqual(['me'])
    expect(h.activity).toEqual([{ withDetail: false, agentId: 'me' }])
  })

  it('an admin with "assigned only" on gets their own scope too', async () => {
    h.role = 'admin'
    h.flag = true
    await get('section=metrics')
    expect(h.metrics).toEqual(['me'])
  })

  it('an unflagged supervisor, admin or owner sees the account, with previews', async () => {
    for (const role of ['supervisor', 'admin', 'owner']) {
      h.role = role
      h.metrics = []
      h.activity = []
      await get()
      expect(h.metrics).toEqual([null])
      expect(h.activity).toEqual([{ withDetail: true, agentId: null }])
    }
  })

  it('someone without the Dashboard page is refused before anything is read', async () => {
    h.role = 'supervisor'
    h.pageOk = false
    const res = await get()
    expect(res.status).toBe(403)
    expect(h.metrics).toHaveLength(0)
  })
})
