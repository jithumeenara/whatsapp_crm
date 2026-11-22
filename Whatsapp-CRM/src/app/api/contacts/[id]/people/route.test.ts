import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * People on one number: renaming one person changes only that person (the
 * bug: renaming changed both); another workspace's contact or person never
 * resolves; a person with a lead cannot be removed; viewers only read.
 */

const C1 = '11111111-1111-4111-8111-aaaaaaaaaaaa'
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const h = vi.hoisted(() => ({
  role: 'agent',
  people: [] as Array<Record<string, unknown>>,
  leadCount: 0,
  deleted: [] as string[],
  contactUpdates: 0,
}))

vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: async (_r: unknown, min: string) => {
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc', userId: 'me', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findFirst: async ({ where }: { where: { id: string; account_id: string } }) => (where.id === '11111111-1111-4111-8111-aaaaaaaaaaaa' && where.account_id === 'acc' ? { id: where.id } : null),
      update: async () => { h.contactUpdates++ },
    },
    contactPerson: {
      findMany: async () => h.people.map((p) => ({ ...p, _count: { leads: 0 } })),
      findFirst: async ({ where }: { where: { id: string; account_id: string; contact_id: string } }) =>
        h.people.find((p) => p.id === where.id && p.account_id === where.account_id && p.contact_id === where.contact_id) ?? null,
      count: async () => h.people.length,
      create: async ({ data }: { data: Record<string, unknown> }) => { const p = { id: '33333333-3333-4333-8333-333333333333', ...data }; h.people.push(p); return p },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const p = h.people.find((x) => x.id === where.id)!; Object.assign(p, data); return p },
      delete: async ({ where }: { where: { id: string } }) => { h.deleted.push(where.id) },
    },
    lead: { count: async () => h.leadCount },
  },
}))

import { GET, POST } from './route'
import { DELETE, PATCH } from './[personId]/route'

const pp = (personId: string, id = C1) => ({ params: Promise.resolve({ id, personId }) })
const r = (method: string, body?: unknown) => new NextRequest('http://x', { method, body: body ? JSON.stringify(body) : undefined })

beforeEach(() => {
  h.role = 'agent'; h.leadCount = 0; h.deleted = []; h.contactUpdates = 0
  h.people = [
    { id: P1, account_id: 'acc', contact_id: C1, name: 'Anu', age: 30 },
    { id: P2, account_id: 'acc', contact_id: C1, name: 'Meera', age: 9 },
  ]
})

describe('people on one number', () => {
  it('renaming one person changes only that person, never the other or the contact', async () => {
    const res = await PATCH(r('PATCH', { name: 'Anu Ravi' }), pp(P1))
    expect(res.status).toBe(200)
    expect(h.people.find((p) => p.id === P1)?.name).toBe('Anu Ravi')
    expect(h.people.find((p) => p.id === P2)?.name).toBe('Meera')
    expect(h.contactUpdates).toBe(0)
  })

  it("another workspace's contact or a person of another number does not resolve", async () => {
    expect((await GET(r('GET'), { params: Promise.resolve({ id: '99999999-9999-4999-8999-999999999999' }) })).status).toBe(404)
    expect((await PATCH(r('PATCH', { name: 'x' }), pp(P1, '99999999-9999-4999-8999-999999999999'))).status).toBe(404)
    expect((await PATCH(r('PATCH', { name: 'x' }), pp("1' OR '1'='1"))).status).toBe(404)
  })

  it('a person with a lead cannot be removed; one without can', async () => {
    h.leadCount = 2
    expect((await DELETE(r('DELETE'), pp(P1))).status).toBe(409)
    expect(h.deleted).toEqual([])
    h.leadCount = 0
    expect((await DELETE(r('DELETE'), pp(P1))).status).toBe(200)
    expect(h.deleted).toEqual([P1])
  })

  it('adding checks every field; a viewer may only read', async () => {
    expect((await POST(r('POST', { name: { $ne: '' } }), { params: Promise.resolve({ id: C1 }) })).status).toBe(400)
    expect((await POST(r('POST', { name: 'Kid', age: '200' }), { params: Promise.resolve({ id: C1 }) })).status).toBe(400)
    expect((await POST(r('POST', { name: 'Kid', relation: 'son', age: '7' }), { params: Promise.resolve({ id: C1 }) })).status).toBe(201)
    h.role = 'viewer'
    expect((await GET(r('GET'), { params: Promise.resolve({ id: C1 }) })).status).toBe(200)
    expect((await POST(r('POST', { name: 'x' }), { params: Promise.resolve({ id: C1 }) })).status).toBe(403)
  })
})
