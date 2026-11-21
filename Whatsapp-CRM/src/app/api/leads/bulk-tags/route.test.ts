import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  role: 'agent',
  leadWhere: [] as Array<Record<string, unknown>>,
  leads: [] as Array<{ id: string; contact_id: string | null }>,
  tag: { id: 't1', name: 'VIP' } as null | { id: string; name: string },
  added: [] as Array<Record<string, unknown>>,
  removed: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acc', userId: 'me', role: h.role, pageAccess: null }),
  assertPageAccess: () => {},
  toErrorResponse: (e: unknown) => { throw e },
}))
vi.mock('@/lib/auth/roles', () => ({ canViewAllLeads: (r: string) => ['owner', 'admin', 'supervisor'].includes(r) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response('', { status: 429 }) }))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/contacts/tag-events', () => ({
  addTagsToContacts: async (a: { pairs: unknown[] }) => { h.added.push(a); return a.pairs.map(() => 't1') },
  removeTagsFromContact: async (a: Record<string, unknown>) => { h.removed.push(a); return ['t1'] },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    tag: { findFirst: async ({ where }: { where: { account_id: string } }) => (where.account_id === 'acc' ? h.tag : null) },
    lead: { findMany: async ({ where }: { where: Record<string, unknown> }) => { h.leadWhere.push(where); return h.leads } },
  },
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('http://x/api/leads/bulk-tags', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.role = 'agent'
  h.leadWhere = []; h.added = []; h.removed = []
  h.leads = [{ id: 'L1', contact_id: 'C1' }, { id: 'L2', contact_id: 'C1' }, { id: 'L3', contact_id: null }]
  h.tag = { id: 't1', name: 'VIP' }
})

describe('POST /api/leads/bulk-tags', () => {
  it('adds one tag to each person once (two leads of one person count once), skipping leads without a contact', async () => {
    const res = await post({ ids: ['L1', 'L2', 'L3'], tag_id: 't1', op: 'add' })
    expect(res.status).toBe(200)
    expect(h.added[0]).toMatchObject({ accountId: 'acc', source: 'inbox', pairs: [{ contactId: 'C1', tagId: 't1' }] })
    expect(await res.json()).toMatchObject({ people: 1, skippedNoContact: 1, skippedNotYours: 0 })
  })

  it('an agent only changes their own leads', async () => {
    await post({ ids: ['L1'], tag_id: 't1', op: 'add' })
    expect(h.leadWhere[0]).toMatchObject({ account_id: 'acc', assigned_to: 'me' })
  })

  it('a supervisor may change any lead in the account', async () => {
    h.role = 'supervisor'
    await post({ ids: ['L1'], tag_id: 't1', op: 'add' })
    expect(h.leadWhere[0]).not.toHaveProperty('assigned_to')
    expect(h.leadWhere[0]).toMatchObject({ account_id: 'acc' })
  })

  it('removes only that one tag, never the others', async () => {
    await post({ ids: ['L1'], tag_id: 't1', op: 'remove' })
    expect(h.removed[0]).toMatchObject({ contactId: 'C1', tagIds: ['t1'], source: 'inbox' })
    expect(h.removed[0]).not.toHaveProperty('keepTagIds')
  })

  it('a tag from another account is not found', async () => {
    h.tag = null
    expect((await post({ ids: ['L1'], tag_id: 'other', op: 'add' })).status).toBe(404)
    expect(h.added).toHaveLength(0)
  })

  it('refuses an unknown action, an empty selection and more than 200 leads', async () => {
    expect((await post({ ids: ['L1'], tag_id: 't1', op: 'replace' })).status).toBe(400)
    expect((await post({ ids: [], tag_id: 't1', op: 'add' })).status).toBe(400)
    expect((await post({ ids: Array.from({ length: 201 }, (_, i) => `L${i}`), tag_id: 't1', op: 'add' })).status).toBe(400)
  })
})
