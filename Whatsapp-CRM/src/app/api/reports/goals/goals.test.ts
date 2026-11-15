import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Goals API (plan §8: owners and admins set goals): a supervisor cannot;
 * the body's account / creator are never used; another business's goal
 * is 404; a duplicate goal is a plain 409, not a server error.
 */

const U1 = '11111111-1111-4111-8111-111111111111'
const G1 = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({ role: 'admin', created: [] as Array<Record<string, unknown>>, dup: false, owner: 'acc-1' }))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  const rank: Record<string, number> = { viewer: 0, agent: 1, supervisor: 2, admin: 3, owner: 4 }
  return {
    ForbiddenError,
    requireRole: (min: string) => (rank[h.role] >= rank[min] ? Promise.resolve({ userId: U1, accountId: 'acc-1', role: h.role }) : Promise.reject(new ForbiddenError('Forbidden'))),
    assertPageAccess: () => {},
    toErrorResponse: (e: { message?: string; status?: number }) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}), audit: () => Promise.resolve() }))
vi.mock('@/lib/reports/schedule/team', () => ({ loadScheduleTeam: () => Promise.resolve({ roles: new Map([[U1, 'agent']]), members: [] }) }))
vi.mock('@/lib/db', async () => {
  const { Prisma } = await import('@prisma/client')
  return {
    prisma: {
      reportGoal: {
        count: () => Promise.resolve(0),
        create: ({ data }: { data: Record<string, unknown> }) => {
          if (h.dup) return Promise.reject(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
          h.created.push(data)
          return Promise.resolve({ id: G1, ...data })
        },
        findFirst: ({ where }: { where: { account_id: string } }) => Promise.resolve(where.account_id === h.owner ? { id: G1, metric: 'won', period: 'month', target: 50, user_id: null } : null),
        updateMany: () => Promise.resolve({ count: 1 }),
        deleteMany: () => Promise.resolve({ count: 1 }),
      },
    },
  }
})

const req = (method: string, b?: unknown) => new NextRequest('http://x/api/reports/goals', { method, body: b ? JSON.stringify(b) : undefined })

beforeEach(() => { h.role = 'admin'; h.created = []; h.dup = false; h.owner = 'acc-1' })

describe('goals API', () => {
  it('a supervisor cannot set goals', async () => {
    h.role = 'supervisor'
    const { POST } = await import('./route')
    expect((await POST(req('POST', { metric: 'won', period: 'month', target: 50 }))).status).toBe(403)
    expect(h.created).toEqual([])
  })
  it("an admin sets one for their own business; the body's account and creator are ignored", async () => {
    const { POST } = await import('./route')
    expect((await POST(req('POST', { metric: 'won', period: 'month', target: 50, account_id: 'evil', created_by: 'evil' }))).status).toBe(200)
    expect(h.created[0]).toMatchObject({ account_id: 'acc-1', created_by: U1, metric: 'won', target: 50, user_id: null })
  })
  it('a duplicate goal is a plain 409', async () => {
    h.dup = true
    const { POST } = await import('./route')
    const res = await POST(req('POST', { metric: 'won', period: 'month', target: 50 }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already a goal/)
  })
  it("another business's goal is not found", async () => {
    h.owner = 'other'
    const { PATCH, DELETE } = await import('./[id]/route')
    expect((await PATCH(req('PATCH', { target: 60 }), { params: Promise.resolve({ id: G1 }) })).status).toBe(404)
    expect((await DELETE(req('DELETE'), { params: Promise.resolve({ id: G1 }) })).status).toBe(404)
  })
})
