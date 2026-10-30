import { describe, expect, it, vi } from 'vitest'

/**
 * N2 (security review 2026-10): keys with no recorded creator are refused
 * and migration 154 revokes them. The owner must learn why an integration
 * stopped, so GET /api/api-keys says whether this account had such keys.
 */

const h = vi.hoisted(() => ({ creatorless: 0, countWhere: null as unknown, fail: false }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'owner-1', accountId: 'acc', role: 'owner' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: () => Promise.resolve([]),
      count: ({ where }: { where: unknown }) => {
        h.countWhere = where
        return h.fail ? Promise.reject(new Error('db')) : Promise.resolve(h.creatorless)
      },
    },
  },
}))

import { GET } from './route'

describe('GET /api/api-keys — older keys notice', () => {
  it('is on when the account had keys with no recorded creator (revoked or not)', async () => {
    h.creatorless = 2
    const body = await (await GET()).json()
    expect(body.legacy_keys_off).toBe(true)
    expect(h.countWhere).toEqual({ account_id: 'acc', created_by_user_id: null })
  })
  it('is off when every key has a creator', async () => {
    h.creatorless = 0
    expect((await (await GET()).json()).legacy_keys_off).toBe(false)
  })
  it('a failed count never breaks the list', async () => {
    h.fail = true
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).legacy_keys_off).toBe(false)
    spy.mockRestore()
    h.fail = false
  })
})
