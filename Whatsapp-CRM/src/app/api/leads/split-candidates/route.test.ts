import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Split screen data: numbers with two or more leads that have no person,
 * this workspace only, supervisor+; read-only.
 */

const h = vi.hoisted(() => ({ role: 'supervisor', groupWhere: null as Record<string, unknown> | null, groups: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/auth/account', () => ({
  requirePageAccess: async (page: string, min: string) => {
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (page !== '/leads' || rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc', userId: 'me', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      groupBy: async (a: { where: Record<string, unknown> }) => { h.groupWhere = a.where; return h.groups },
      findMany: async ({ where }: { where: { account_id: string } }) => (where.account_id === 'acc' ? [
        { id: 'L1', contact_id: 'C1', title: 'Anu', status: 'new', created_at: new Date() },
        { id: 'L2', contact_id: 'C1', title: 'Meera', status: 'new', created_at: new Date() },
      ] : []),
    },
    contact: { findMany: async () => [{ id: 'C1', name: 'Ravi', phone: '919847012345' }] },
    contactPerson: { findMany: async () => [] },
  },
}))

import { GET } from './route'

beforeEach(() => { h.role = 'supervisor'; h.groups = [{ contact_id: 'C1', _count: { _all: 2 } }]; h.groupWhere = null })

describe('split candidates', () => {
  it('numbers with several person-less leads, this workspace only', async () => {
    const body = await (await GET()).json()
    expect(h.groupWhere).toMatchObject({ account_id: 'acc', person_id: null })
    expect(body.numbers[0].contact.id).toBe('C1')
    expect(body.numbers[0].leads.map((l: { id: string }) => l.id)).toEqual(['L1', 'L2'])
  })
  it('an agent cannot open the split screen data', async () => {
    h.role = 'agent'
    expect((await GET()).status).toBe(403)
  })
  it('nothing to split: an empty list', async () => {
    h.groups = []
    expect(await (await GET()).json()).toEqual({ numbers: [] })
  })
})
