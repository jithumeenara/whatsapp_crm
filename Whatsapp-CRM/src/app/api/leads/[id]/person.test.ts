import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PATCH /api/leads/[id] { person_id } — which person on the number a lead is
 * for: only a person of THIS lead's number in THIS workspace; null goes back
 * to the number's owner; moving the lead to another number drops its person.
 */

const P1 = '11111111-1111-4111-8111-111111111111'
const P9 = '99999999-9999-4999-8999-999999999999'
const h = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[] }))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: 'supervisor' }),
  toErrorResponse: (err: unknown) => { throw err },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/meta-ads/triggers', () => ({ reportMetaAdsOutcome: () => Promise.resolve() }))
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: () => Promise.resolve() }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/db', () => {
  const lead = () => ({ id: 'l1', account_id: 'acc', assigned_to: 'me', status: 'new', contact_id: 'c-mine', person_id: null, notes: null, lead_quality: null })
  return {
    prisma: {
      lead: {
        findFirst: () => Promise.resolve(lead()),
        update: (a: { data: Record<string, unknown> }) => { h.updates.push(a.data); return Promise.resolve({ ...lead(), ...a.data }) },
        updateMany: () => Promise.resolve({ count: 1 }),
      },
      contact: { findFirst: (a: { where: { id: string; account_id: string } }) => Promise.resolve(['c-mine', 'c-other'].includes(a.where.id) && a.where.account_id === 'acc' ? { id: a.where.id } : null) },
      contactPerson: {
        findFirst: (a: { where: { id: string; account_id: string; contact_id: string } }) =>
          Promise.resolve(a.where.id === '11111111-1111-4111-8111-111111111111' && a.where.account_id === 'acc' && a.where.contact_id === 'c-mine' ? { id: a.where.id } : null),
      },
      profile: { findFirst: () => Promise.resolve({ user_id: 'me' }), findUnique: () => Promise.resolve({ full_name: 'X' }) },
      leadActivity: { create: () => Promise.resolve({}) },
      followUp: { create: () => Promise.resolve({}), updateMany: () => Promise.resolve({ count: 0 }) },
      conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
    },
  }
})

import { PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'l1' }) })

beforeEach(() => { h.updates = [] })

describe('which person on the number a lead is for', () => {
  it("a person of this lead's number is set", async () => {
    expect((await patch({ person_id: P1 })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ person_id: P1 })
  })
  it('a person of another number or workspace, or a bad id, is refused and nothing changes', async () => {
    expect((await patch({ person_id: P9 })).status).toBe(404)
    expect((await patch({ person_id: 'x; drop' })).status).toBe(400)
    expect(h.updates).toEqual([])
  })
  it("null goes back to the number's owner; another number drops the person", async () => {
    await patch({ person_id: null })
    expect(h.updates[0]).toMatchObject({ person_id: null })
    await patch({ contact_id: 'c-other' })
    expect(h.updates[1]).toMatchObject({ contact_id: 'c-other', person_id: null })
  })

  it('removing the number and choosing a person in one request does not fall back to the old number', async () => {
    const res = await patch({ contact_id: '', person_id: P1 })
    expect(res.status).toBe(400)
    expect(h.updates).toEqual([])
  })
})
