import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A key stayed good for ever, whoever made it. Remove the member who
 * minted it, or demote them, and their key went on reading and writing
 * the account at supervisor rank. A key now answers to its creator on
 * every request: they must still be a member of that account at no less
 * than the key's own rank. A revoked or expired key is refused.
 *
 * Keys made before creators were recorded (created_by_user_id null) used
 * to be treated as the owner's and kept working. Any member could mint a
 * key then (A2-01), so the owner decided (security review N2, 2026-10)
 * that they are refused; migration 154 also revokes them.
 */

type Key = { id: string; account_id: string; key_hash: string; key_prefix: string; created_by_user_id: string | null; expires_at: Date | null; revoked_at: Date | null }
const h = vi.hoisted(() => ({ keys: [] as Key[], profiles: new Map<string, { account_id: string; account_role: string }>() }))

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        h.keys.filter((k) => {
          if (k.key_prefix !== where.key_prefix) return false
          if ('revoked_at' in where && where.revoked_at === null && k.revoked_at) return false
          const or = where.OR as Array<Record<string, unknown>> | undefined
          if (or) {
            const ok = or.some((c) =>
              c.expires_at === null ? k.expires_at === null : k.expires_at !== null && k.expires_at > (c.expires_at as { gt: Date }).gt,
            )
            if (!ok) return false
          }
          return true
        }),
      update: () => Promise.resolve({}),
    },
    profile: {
      findUnique: async ({ where }: { where: { user_id: string } }) => h.profiles.get(where.user_id) ?? null,
    },
  },
}))

import { verifyApiKey } from './api-key'

const RAW = `wcrm_${'b'.repeat(64)}`
function key(over: Partial<Key> = {}): Key {
  return {
    id: 'k1', account_id: 'acc', key_hash: createHash('sha256').update(RAW).digest('hex'), key_prefix: RAW.slice(0, 12),
    created_by_user_id: 'creator', expires_at: null, revoked_at: null, ...over,
  }
}

describe('verifying an API key', () => {
  beforeEach(() => {
    h.keys = []
    h.profiles.clear()
  })

  it('works while its creator is still an owner of the account', async () => {
    h.keys = [key()]
    h.profiles.set('creator', { account_id: 'acc', account_role: 'owner' })
    await expect(verifyApiKey(RAW)).resolves.toEqual(expect.objectContaining({ accountId: 'acc', creatorUserId: 'creator' }))
  })

  it('stops working once its creator is removed from the account', async () => {
    h.keys = [key()]
    h.profiles.set('creator', { account_id: 'holding-account', account_role: 'viewer' })
    await expect(verifyApiKey(RAW)).resolves.toBeNull()
  })

  it('stops working once its creator is demoted below the key’s supervisor rank', async () => {
    h.keys = [key()]
    h.profiles.set('creator', { account_id: 'acc', account_role: 'agent' })
    await expect(verifyApiKey(RAW)).resolves.toBeNull()
  })

  it('is refused once revoked', async () => {
    h.keys = [key({ revoked_at: new Date() })]
    h.profiles.set('creator', { account_id: 'acc', account_role: 'owner' })
    await expect(verifyApiKey(RAW)).resolves.toBeNull()
  })

  it('is refused once expired', async () => {
    h.keys = [key({ expires_at: new Date(Date.now() - 1000) })]
    h.profiles.set('creator', { account_id: 'acc', account_role: 'owner' })
    await expect(verifyApiKey(RAW)).resolves.toBeNull()
  })

  it('a key made before creators were recorded is refused (N2: policy changed by the owner)', async () => {
    h.keys = [key({ created_by_user_id: null })]
    await expect(verifyApiKey(RAW)).resolves.toBeNull()
  })
})
