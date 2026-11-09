import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/reports/spending.
 *
 * Spend is for people who run the team: supervisors and above, and only
 * with the Reports page. An agent never sees what the business spends, nor
 * what a colleague's messages cost; the scope is decided here from the role,
 * and no parameter can widen it.
 */

const h = vi.hoisted(() => ({
  role: 'supervisor' as string,
  pageOk: true,
  userId: 'u1',
  calls: [] as Array<Record<string, any>>,
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
vi.mock('@/lib/reports/spending', () => ({
  loadSpending: (a: Record<string, any>) => {
    h.calls.push(a)
    return Promise.resolve({ totals: { combined: 0 }, warnings: [] })
  },
}))

import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`http://x/api/reports/spending?${qs}`))

beforeEach(() => {
  h.role = 'supervisor'
  h.pageOk = true
  h.userId = `u-${Math.random()}`
  h.calls = []
})

describe('GET /api/reports/spending', () => {
  it('is closed to agents and viewers, whatever they ask for', async () => {
    for (const role of ['viewer', 'agent']) {
      h.role = role
      expect((await get('period=week&user=someone&scope=team')).status).toBe(403)
    }
    expect(h.calls).toHaveLength(0)
  })

  it('is closed to a supervisor who was not given the Reports page', async () => {
    h.pageOk = false
    expect((await get('period=week')).status).toBe(403)
    expect(h.calls).toHaveLength(0)
  })

  it('gives supervisors and above the whole business, scoped to their own account', async () => {
    for (const role of ['supervisor', 'admin', 'owner']) {
      h.role = role
      const res = await get('period=month')
      expect(res.status).toBe(200)
    }
    expect(h.calls.every((c) => c.accountId === 'acc-1')).toBe(true)
  })

  it('ignores any account or user in the query', async () => {
    await get('period=week&accountId=other&account_id=other&userId=x')
    expect(h.calls[0].accountId).toBe('acc-1')
    expect(h.calls[0]).not.toHaveProperty('userId')
  })

  it('answers a bad period in plain words, with a 400', async () => {
    const res = await get('period=forever')
    expect(res.status).toBe(400)
    expect(typeof (await res.json()).error).toBe('string')
    expect((await get('period=custom&from=2026-02-01&to=2025-01-01')).status).toBe(400)
  })

  it('turns away the thirty-first load in a minute from one person', async () => {
    let last = 200
    for (let i = 0; i < 31; i++) last = (await get('period=week')).status
    expect(last).toBe(429)
  })
})
