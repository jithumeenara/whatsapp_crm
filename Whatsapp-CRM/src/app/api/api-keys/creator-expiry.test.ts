import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Round 2: a key records who minted it (so removing that person ends it)
 * and may be given an end date, at most a year out. Revoked keys drop off
 * the list; the DELETE endpoint still removes a key outright.
 */

const h = vi.hoisted(() => ({ created: null as Record<string, unknown> | null, listWhere: null as unknown }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'owner-1', accountId: 'acc', role: 'owner' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        h.created = data
        return Promise.resolve({ id: 'k', name: data.name, key_prefix: data.key_prefix, created_at: new Date(), expires_at: data.expires_at ?? null })
      },
      findMany: ({ where }: { where: unknown }) => {
        h.listWhere = where
        return Promise.resolve([])
      },
    },
  },
}))

import { GET, POST } from './route'

const post = (body: unknown) => POST(new Request('http://x/api/api-keys', { method: 'POST', body: JSON.stringify(body) }))
const DAY = 24 * 60 * 60 * 1000

describe('minting a key', () => {
  beforeEach(() => {
    h.created = null
  })

  it('records who minted it', async () => {
    expect((await post({ name: 'zapier' })).status).toBe(201)
    expect(h.created).toEqual(expect.objectContaining({ account_id: 'acc', created_by_user_id: 'owner-1', expires_at: null }))
  })

  it('takes an optional end date up to a year away', async () => {
    const at = new Date(Date.now() + 30 * DAY).toISOString()
    expect((await post({ name: 'zapier', expires_at: at })).status).toBe(201)
    expect((h.created!.expires_at as Date).toISOString()).toBe(at)
  })

  it('refuses an end date in the past, more than a year away, or unreadable', async () => {
    for (const expires_at of [new Date(Date.now() - DAY).toISOString(), new Date(Date.now() + 400 * DAY).toISOString(), 'soon', 42]) {
      expect((await post({ name: 'zapier', expires_at })).status).toBe(400)
    }
    expect(h.created).toBeNull()
  })

  it('lists only keys that have not been revoked', async () => {
    expect((await GET()).status).toBe(200)
    expect(h.listWhere).toEqual({ account_id: 'acc', revoked_at: null })
  })
})
