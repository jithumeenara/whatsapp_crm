/**
 * Independent security review (A7, 2026-10) — API keys after migration 152.
 *
 * Verified secure (passing): revoked / expired keys are filtered in the
 * query; a key whose creator left or was demoted below supervisor is
 * refused; the lookup is uncached (every call hits prisma).
 *
 * GAP (HIGH, documented with it.fails): before this audit ANY member
 * (viewer, agent) could mint a key (A2-01). Migration 152 adds
 * created_by_user_id but backfills nothing, and verifyApiKey treats a key
 * with no creator as "the owner's — keeps working". So every key minted
 * by a viewer/agent during the vulnerable window keeps supervisor-rank
 * access forever: it survives that person's removal (deactivateMember
 * revokes only keys WHERE created_by_user_id = them) and demotion. Fix:
 * on deploy revoke (revoked_at = now()) every key with created_by_user_id
 * IS NULL, or refuse such keys in verifyApiKey after a grace date, and
 * tell owners to re-mint.
 */
import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  key: null as null | Record<string, unknown>,
  profile: null as null | { account_id: string; account_role: string },
  findManyCalls: [] as unknown[],
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: async (args: unknown) => {
        h.findManyCalls.push(args)
        return h.key ? [h.key] : []
      },
      update: async () => ({}),
    },
    profile: { findUnique: async () => h.profile },
  },
}))

import { verifyApiKey } from '@/lib/auth/api-key'

const raw = 'wcrm_' + 'a'.repeat(64)
const hash = createHash('sha256').update(raw).digest('hex')

beforeEach(() => {
  h.findManyCalls = []
  h.profile = null
})

describe('API key verification', () => {
  it('filters revoked and expired keys in the query itself', async () => {
    h.key = null
    expect(await verifyApiKey(raw)).toBeNull()
    const where = (h.findManyCalls[0] as { where: Record<string, unknown> }).where
    expect(where.revoked_at).toBeNull()
    expect(JSON.stringify(where.OR)).toContain('expires_at')
  })
  it('refuses a key whose creator moved to another account (removed)', async () => {
    h.key = { id: 'k', account_id: 'acc', key_hash: hash, created_by_user_id: 'u-gone' }
    h.profile = { account_id: 'holding', account_role: 'owner' }
    expect(await verifyApiKey(raw)).toBeNull()
  })
  it('refuses a key whose creator was demoted below supervisor', async () => {
    h.key = { id: 'k', account_id: 'acc', key_hash: hash, created_by_user_id: 'u1' }
    h.profile = { account_id: 'acc', account_role: 'agent' }
    expect(await verifyApiKey(raw)).toBeNull()
  })
  it('checks again on every call (no cache)', async () => {
    h.key = { id: 'k', account_id: 'acc', key_hash: hash, created_by_user_id: 'u1' }
    h.profile = { account_id: 'acc', account_role: 'supervisor' }
    expect(await verifyApiKey(raw)).not.toBeNull()
    h.key = null // revoked/deleted
    expect(await verifyApiKey(raw)).toBeNull()
    expect(h.findManyCalls.length).toBe(2)
  })
  it('refuses wrong prefix / short input without touching the DB', async () => {
    expect(await verifyApiKey('Bearer wcrm_x')).toBeNull()
    expect(await verifyApiKey('wcrm_short')).toBeNull()
    expect(h.findManyCalls.length).toBe(0)
  })

  it('a pre-migration key (no recorded creator, possibly minted by a viewer under A2-01) is not honoured indefinitely', async () => {
    h.key = { id: 'k', account_id: 'acc', key_hash: hash, created_by_user_id: null }
    expect(await verifyApiKey(raw)).toBeNull()
  })
})
