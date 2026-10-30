import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PATCH /api/leads/[id] — who may change a lead, and what it may point at.
 *
 *  - The "claim" shorthand refused an agent a colleague's lead, but a plain
 *    PATCH did not: `{ assigned_to: "<me>" }` took it, and any other field
 *    edited it. An agent may claim from the pool and work their own leads;
 *    moving one between people is a supervisor's call.
 *  - `assigned_to` and `contact_id` were written as given. A contact id
 *    from another workspace attached that workspace's customer to this
 *    lead, and the lead's response then carried their name and number.
 */

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  assignee: null as string | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: h.role }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/meta-ads/triggers', () => ({ reportMetaAdsOutcome: () => Promise.resolve() }))
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: () => Promise.resolve() }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/db', () => {
  const lead = () => ({ id: 'l1', account_id: 'acc', assigned_to: h.assignee, status: 'new', contact_id: null, notes: null, lead_quality: null })
  return {
    prisma: {
      lead: {
        findFirst: () => Promise.resolve(lead()),
        update: (a: { data: Record<string, unknown> }) => {
          h.updates.push(a.data)
          return Promise.resolve({ ...lead(), ...a.data })
        },
        updateMany: () => Promise.resolve({ count: 1 }),
      },
      contact: { findFirst: (a: { where: { id: string; account_id: string } }) => Promise.resolve(a.where.id === 'c-mine' && a.where.account_id === 'acc' ? { id: 'c-mine' } : null) },
      profile: {
        findFirst: (a: { where: { user_id: string; account_id: string } }) =>
          Promise.resolve(['me', 'colleague'].includes(a.where.user_id) && a.where.account_id === 'acc' ? { user_id: a.where.user_id } : null),
        findUnique: () => Promise.resolve({ full_name: 'X' }),
      },
      leadActivity: { create: () => Promise.resolve({}) },
      followUp: { create: () => Promise.resolve({}), updateMany: () => Promise.resolve({ count: 0 }) },
      conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
    },
  }
})

import { PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'l1' }) })

describe('PATCH /api/leads/[id]', () => {
  beforeEach(() => {
    h.updates = []
    h.assignee = null
    h.role = 'agent'
  })

  it('an agent cannot take a colleague’s lead by assigning it to themselves', async () => {
    h.assignee = 'colleague'
    const res = await patch({ assigned_to: 'me' })
    expect(res.status).toBe(403)
    expect(h.updates).toEqual([])
  })

  it('an agent cannot edit a colleague’s lead', async () => {
    h.assignee = 'colleague'
    expect((await patch({ status: 'lost' })).status).toBe(403)
    expect(h.updates).toEqual([])
  })

  it('an agent cannot hand their own lead to somebody else', async () => {
    h.assignee = 'me'
    expect((await patch({ assigned_to: 'colleague' })).status).toBe(403)
    expect(h.updates).toEqual([])
  })

  it('a contact or assignee from another workspace is refused', async () => {
    h.role = 'supervisor'
    expect((await patch({ contact_id: 'c-theirs' })).status).toBe(400)
    expect((await patch({ assigned_to: 'stranger' })).status).toBe(400)
    expect(h.updates).toEqual([])
  })

  it('an agent still works their own and pool leads; a supervisor still reassigns', async () => {
    h.assignee = 'me'
    expect((await patch({ status: 'contacted', contact_id: 'c-mine' })).status).toBe(200)
    h.assignee = null
    expect((await patch({ assigned_to: 'me' })).status).toBe(200)
    h.role = 'supervisor'
    h.assignee = 'colleague'
    expect((await patch({ assigned_to: 'me' })).status).toBe(200)
  })
})
