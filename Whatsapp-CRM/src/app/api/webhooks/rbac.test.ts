import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): /api/webhooks only checked "signed in".
 * A viewer could add an outgoing webhook to any URL and from then on
 * receive every Data Store record of the account — or edit/delete the
 * admin's. Creating, changing and deleting webhooks now needs admin.
 */

const h = vi.hoisted(() => ({ role: 'viewer' as string, created: 0, updated: 0, deleted: 0 }))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: Parameters<typeof hasMinRole>[1]) => {
      if (!hasMinRole(h.role as Parameters<typeof hasMinRole>[0], min)) throw new actual.ForbiddenError('forbidden')
      return { accountId: 'a1', userId: 'u1', role: h.role }
    },
  }
})
// No DNS in tests: a public URL is taken as public.
vi.mock('@/lib/net/safe-fetch', async () => ({
  ...(await vi.importActual<typeof import('@/lib/net/safe-fetch')>('@/lib/net/safe-fetch')),
  assertPublicUrl: async (u: string) => new URL(u),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'a1', account_role: h.role }) },
    webhook: {
      findMany: async () => [],
      findFirst: async () => ({ id: 'w1' }),
      create: async () => {
        h.created++
        return { id: 'w1' }
      },
      update: async () => {
        h.updated++
        return { id: 'w1' }
      },
      delete: async () => {
        h.deleted++
        return { id: 'w1' }
      },
    },
    dataTable: { findFirst: async () => null },
  },
}))

import { GET, POST } from './route'
import { DELETE, PUT } from './[id]/route'

const json = (body: unknown) =>
  new Request('http://x/api/webhooks', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const params = { params: Promise.resolve({ id: 'w1' }) }
const hook = { name: 'n', url: 'https://example.com/hook', events: ['record.created'] }

describe('outgoing webhooks — who may change them', () => {
  beforeEach(() => {
    h.created = h.updated = h.deleted = 0
  })

  for (const role of ['viewer', 'agent', 'supervisor']) {
    it(`a ${role} cannot create, change or delete one`, async () => {
      h.role = role
      expect((await POST(json(hook))).status).toBe(403)
      expect((await PUT(json({ url: 'https://evil.example/x' }), params)).status).toBe(403)
      expect((await DELETE(new Request('http://x'), params)).status).toBe(403)
      expect(h.created + h.updated + h.deleted).toBe(0)
    })
  }

  it('an admin can', async () => {
    h.role = 'admin'
    expect((await POST(json(hook))).status).toBe(201)
    expect((await PUT(json({ name: 'm' }), params)).status).toBe(200)
    expect((await DELETE(new Request('http://x'), params)).status).toBe(200)
  })

  it('any member may still list them (no secrets in the list)', async () => {
    h.role = 'viewer'
    expect((await GET()).status).toBe(200)
  })
})
