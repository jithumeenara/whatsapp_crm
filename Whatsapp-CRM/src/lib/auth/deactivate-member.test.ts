import { describe, expect, it, vi } from 'vitest'

/**
 * Removing a member ended their sessions but left their role in the
 * 60-second profile cache. Any request still in that window (another
 * process's freshly-signed token, an API path that does not re-run the
 * JWT callback) was answered with the team account and the old role.
 * Switching somebody off now drops the cache with it, as does reviving.
 */

const h = vi.hoisted(() => ({ forgotten: [] as string[], invalidated: [] as string[], keyRevoke: null as unknown }))
vi.mock('./account', () => ({ forgetCachedProfile: (id: string) => h.forgotten.push(id) }))
vi.mock('./session-invalidation', () => ({
  invalidateAllSessions: (id: string) => {
    h.invalidated.push(id)
    return Promise.resolve()
  },
}))
const tx = {
  account: { create: () => Promise.resolve({ id: 'holding' }), deleteMany: () => Promise.resolve({ count: 1 }) },
  profile: { update: () => Promise.resolve({}), findUnique: () => Promise.resolve({ account_id: 'holding' }), count: () => Promise.resolve(0) },
  user: { update: () => Promise.resolve({}) },
  apiKey: {
    updateMany: (args: unknown) => {
      h.keyRevoke = args
      return Promise.resolve({ count: 1 })
    },
  },
  contact: { count: () => Promise.resolve(0) },
  conversation: { count: () => Promise.resolve(0) },
}
vi.mock('@/lib/db', () => ({ prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }))

// R4a (round 5): every change to who belongs to which account drops the
// legacy-file business count (src/lib/files/legacy-access.ts) at once.
const biz = vi.hoisted(() => ({ invalidated: 0 }))
vi.mock('@/lib/files/legacy-access', () => ({ invalidateBusinessCount: () => void biz.invalidated++ }))

import { deactivateMember, reviveMember } from './deactivate-member'

describe('switching a member off and on', () => {
  it('drops the legacy-file business count when switching off and when reviving (R4a)', async () => {
    biz.invalidated = 0
    await deactivateMember('u9', 'Z')
    expect(biz.invalidated).toBe(1)
    await reviveMember({ userId: 'u9', accountId: 'team', role: 'agent', fullName: 'Z', passwordHash: 'x' })
    expect(biz.invalidated).toBe(2)
    h.invalidated = []
    h.forgotten = []
  })

  it('ends their sessions and forgets their cached role', async () => {
    await deactivateMember('u1', 'Anu')
    expect(h.invalidated).toEqual(['u1'])
    expect(h.forgotten).toContain('u1')
  })

  it('reviving forgets the cached holding-account role too', async () => {
    h.forgotten = []
    await reviveMember({ userId: 'u2', accountId: 'team', role: 'agent', fullName: 'B', passwordHash: 'x' })
    expect(h.forgotten).toContain('u2')
  })

  it('revokes the API keys they minted — softly, kept for the audit trail (round 2)', async () => {
    h.keyRevoke = null
    await deactivateMember('u3', 'C')
    expect(h.keyRevoke).toEqual({
      where: { created_by_user_id: 'u3', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    })
  })
})
