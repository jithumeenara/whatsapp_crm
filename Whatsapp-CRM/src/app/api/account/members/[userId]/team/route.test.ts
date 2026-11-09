import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * Putting a member in a team (Settings → Members), for the Spending report's
 * "by team". Admins only; the member must belong to the admin's own business
 * (an id from the address is never enough); the team name is checked.
 */

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  member: true,
  upserts: [] as Array<Record<string, any>>,
  deletes: [] as Array<Record<string, any>>,
  profileWhere: null as any,
  audits: [] as Array<Record<string, any>>,
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  const rank: Record<string, number> = { viewer: 1, agent: 2, supervisor: 3, admin: 4, owner: 5 }
  return {
    ForbiddenError,
    requireRole: (min: string) => {
      if ((rank[h.role] ?? 0) < (rank[min] ?? 99)) throw new ForbiddenError('no')
      return Promise.resolve({ userId: 'admin-1', accountId: 'acc-1', role: h.role })
    },
    toErrorResponse: (e: any) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({
  auditConfigChange: (_c: unknown, action: string, opts: Record<string, any>) => {
    h.audits.push({ action, ...opts })
    return Promise.resolve()
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findFirst: ({ where }: any) => {
        h.profileWhere = where
        return Promise.resolve(h.member ? { user_id: where.user_id } : null)
      },
    },
    memberTeam: {
      upsert: (a: any) => {
        h.upserts.push(a)
        return Promise.resolve({})
      },
      deleteMany: (a: any) => {
        h.deletes.push(a)
        return Promise.resolve({ count: 1 })
      },
    },
  },
}))

import { PUT } from './route'

const MEMBER = '8f6c1c0e-2f67-4c2a-9a5e-0d1f2b3c4d5e'
const put = (body: unknown, userId = MEMBER) =>
  PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }), { params: Promise.resolve({ userId }) })

beforeEach(() => {
  h.role = 'admin'
  h.member = true
  h.upserts = []
  h.deletes = []
  h.profileWhere = null
  h.audits = []
})

describe('PUT /api/account/members/[userId]/team', () => {
  it('is for admins only', async () => {
    for (const role of ['viewer', 'agent', 'supervisor']) {
      h.role = role
      expect((await put({ team: 'Sales' })).status).toBe(403)
    }
    expect(h.upserts).toHaveLength(0)
  })

  it('puts a member of this business in a team, with the name trimmed', async () => {
    const res = await put({ team: '  Sales  ' })
    expect(res.status).toBe(200)
    expect(h.upserts[0].create).toMatchObject({ account_id: 'acc-1', user_id: MEMBER, team: 'Sales' })
    expect(h.upserts[0].update).toMatchObject({ team: 'Sales' })
  })

  it('looks the member up inside the admin\'s own business, and refuses anyone else\'s', async () => {
    h.member = false
    const res = await put({ team: 'Sales' })
    expect(res.status).toBe(404)
    expect(h.profileWhere).toMatchObject({ account_id: 'acc-1', user_id: MEMBER })
    expect(h.upserts).toHaveLength(0)
  })

  it('takes a member out of their team when the name is empty or null', async () => {
    await put({ team: '' })
    await put({ team: null })
    expect(h.deletes).toHaveLength(2)
    expect(h.deletes[0].where).toMatchObject({ account_id: 'acc-1', user_id: MEMBER })
    expect(h.upserts).toHaveLength(0)
  })

  it('refuses a team name that is too long or has control characters', async () => {
    expect((await put({ team: 'x'.repeat(61) })).status).toBe(400)
    expect((await put({ team: 'Sa\u0000les' })).status).toBe(400)
    expect((await put({ team: 5 })).status).toBe(400)
    expect(h.upserts).toHaveLength(0)
  })

  it('refuses an id that is not a user id, before touching anything', async () => {
    expect((await put({ team: 'Sales' }, "1' OR '1'='1")).status).toBe(400)
    expect(h.profileWhere).toBeNull()
  })

  it('is audited by field name only', async () => {
    await put({ team: 'SECRET-TEAM-NAME' })
    expect(h.audits.length).toBe(1)
    expect(JSON.stringify(h.audits)).not.toContain('SECRET-TEAM-NAME')
  })
})
