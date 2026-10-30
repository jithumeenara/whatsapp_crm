import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Any signed-in member — a viewer, an agent — could mint an API key, and
 * a key acts at supervisor level. That turned the lowest role in the
 * account into a supervisor with one request. The Settings tab was
 * owner-only; the route was not. Minting and revoking are the owner's.
 */

const h = vi.hoisted(() => ({ role: 'owner' as string, userId: 'u-owner', created: 0, deleted: 0 }))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: h.userId } }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findUnique: () =>
        Promise.resolve({
          account_id: 'acc',
          account_role: h.role,
          account: { id: 'acc', name: 'Acme' },
          page_access: null,
        }),
    },
    apiKey: {
      findMany: () => Promise.resolve([]),
      create: () => {
        h.created++
        return Promise.resolve({ id: 'k1', name: 'n', key_prefix: 'wcrm_abcdefg', created_at: new Date() })
      },
      deleteMany: () => {
        h.deleted++
        return Promise.resolve({ count: 1 })
      },
    },
  },
}))

import { GET, POST } from './route'
import { DELETE } from './[id]/route'
import { forgetCachedProfile } from '@/lib/auth/account'

const post = () =>
  POST(new Request('http://x/api/api-keys', { method: 'POST', body: JSON.stringify({ name: 'zapier' }) }))
const del = () => DELETE(new Request('http://x/api/api-keys/k1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'k1' }) })

describe('API keys are the owner’s', () => {
  beforeEach(() => {
    h.created = 0
    h.deleted = 0
  })

  for (const role of ['viewer', 'agent', 'supervisor', 'admin']) {
    it(`a ${role} cannot mint, list or revoke a key`, async () => {
      h.role = role
      h.userId = `u-${role}`
      forgetCachedProfile(h.userId)
      expect((await post()).status).toBe(403)
      expect((await GET()).status).toBe(403)
      expect((await del()).status).toBe(403)
      expect(h.created).toBe(0)
      expect(h.deleted).toBe(0)
    })
  }

  it('the owner can, and the raw key is returned once', async () => {
    h.role = 'owner'
    h.userId = 'u-owner'
    forgetCachedProfile(h.userId)
    const res = await post()
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.raw).toMatch(/^wcrm_[0-9a-f]{64}$/)
    expect((await GET()).status).toBe(200)
    expect((await del()).status).toBe(200)
  })
})
