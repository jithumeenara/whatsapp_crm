import { describe, expect, it, vi } from 'vitest'

/**
 * A request made with an API key acts as somebody, for created_by and
 * the like. It used to borrow the account's EARLIEST profile — whoever
 * happened to join first, possibly an agent, or a person since removed
 * whose profile was the only one left behind. Only the owner can mint a
 * key now, so writes made with one are attributed to the account owner.
 * Its rank stays supervisor whoever that is.
 */

const h = vi.hoisted(() => ({ profileWhere: null as unknown, creator: null as string | null }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve(null) }))
vi.mock('./api-key', () => ({ verifyApiKey: () => Promise.resolve({ accountId: 'acc', keyId: 'k', creatorUserId: h.creator }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    account: { findUnique: () => Promise.resolve({ owner_user_id: 'owner-1' }) },
    profile: {
      findFirst: (args: { where: unknown }) => {
        h.profileWhere = args.where
        const w = args.where as { user_id?: string }
        return Promise.resolve({ user_id: w.user_id ?? 'owner-1', account: { id: 'acc', name: 'Acme' } })
      },
    },
  },
}))

import { requireRoleOrApiKey } from './account'

const req = (method = 'GET') =>
  new Request('http://x/api/contacts', { method, headers: { authorization: `Bearer wcrm_${'a'.repeat(64)}` } })

describe('API key requests', () => {
  it('act as the account owner, at supervisor rank, in the key’s own account', async () => {
    const ctx = await requireRoleOrApiKey(req(), 'viewer')
    expect(ctx).toEqual(expect.objectContaining({ userId: 'owner-1', accountId: 'acc', role: 'supervisor', pageAccess: null }))
    expect(h.profileWhere).toEqual({ account_id: 'acc', user_id: 'owner-1' })
  })

  it('never reach admin-only routes', async () => {
    await expect(requireRoleOrApiKey(req(), 'admin')).rejects.toMatchObject({ status: 403 })
  })

  it('a key with a recorded creator acts as that creator (round 2: keys answer to whoever minted them)', async () => {
    h.creator = 'creator-9'
    const ctx = await requireRoleOrApiKey(req(), 'viewer')
    expect(ctx).toEqual(expect.objectContaining({ userId: 'creator-9', role: 'supervisor' }))
    expect(h.profileWhere).toEqual({ account_id: 'acc', user_id: 'creator-9' })
    h.creator = null
  })
})
