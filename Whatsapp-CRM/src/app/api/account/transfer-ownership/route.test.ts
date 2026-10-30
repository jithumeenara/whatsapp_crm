import { describe, expect, it, vi } from 'vitest'

/**
 * Handing the account over demoted the old owner in the database but not
 * in the 60-second role cache, so for up to a minute they kept every
 * owner-only power (delete the account, mint API keys, hand it on again)
 * over an account that was no longer theirs.
 */

const h = vi.hoisted(() => ({ forgotten: [] as string[] }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: '11111111-1111-1111-1111-111111111111', accountId: 'acc', role: 'owner' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
  forgetCachedProfile: (id: string) => h.forgotten.push(id),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findFirst: () => Promise.resolve({ account_role: 'admin' }), update: () => Promise.resolve({}) },
    account: { update: () => Promise.resolve({}) },
    $transaction: () => Promise.resolve([]),
  },
}))

import { POST } from './route'

describe('transfer ownership', () => {
  it('drops both people’s cached roles at once', async () => {
    const to = '22222222-2222-2222-2222-222222222222'
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ newOwnerUserId: to }) }))
    expect(res.status).toBe(200)
    expect(h.forgotten.sort()).toEqual(['11111111-1111-1111-1111-111111111111', to])
  })
})
