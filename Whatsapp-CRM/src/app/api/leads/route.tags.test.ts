import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Leads list: "No tags" finds the leads nobody has tagged yet (a lead with
// no contact has no tags either), and still keeps every other filter.

const h = vi.hoisted(() => ({ wheres: [] as Array<Record<string, unknown>>, role: 'admin' }))

vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: async () => ({ accountId: 'acc', userId: 'me', role: h.role }),
  assertPageAccess: () => {},
  toErrorResponse: (e: unknown) => { throw e },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => { h.wheres.push(where); return [] },
      count: async () => 0,
    },
    $queryRaw: async () => [],
  },
}))

import { GET } from './route'

const get = (q: string) => GET(new NextRequest(`http://x/api/leads?${q}`))

beforeEach(() => { h.wheres = []; h.role = 'admin' })

describe('GET /api/leads tag filter', () => {
  it('a tag finds leads whose person has that tag', async () => {
    await get('tag_id=t1')
    expect(h.wheres[0].contact).toEqual({ tags: { some: { tag_id: 't1' } } })
  })

  it('"__none" finds leads with no tags, including leads with no contact', async () => {
    await get('tag_id=__none')
    const w = h.wheres[0]
    expect(w.contact).toBeUndefined()
    expect(w.AND).toContainEqual({ OR: [{ contact_id: null }, { contact: { tags: { none: {} } } }] })
  })

  it('"__none" keeps an agent to their own pool rule', async () => {
    h.role = 'agent'
    await get('tab=new_pool&tag_id=__none')
    const and = h.wheres[0].AND as unknown[]
    expect(and).toContainEqual({ OR: [{ contact_id: null }, { contact: { tags: { none: {} } } }] })
    expect(and.length).toBeGreaterThanOrEqual(1)
  })
})
