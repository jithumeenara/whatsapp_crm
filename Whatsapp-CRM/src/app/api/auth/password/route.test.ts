import { describe, expect, it, vi } from 'vitest'

/**
 * Changing a password is what somebody does when they think it has been
 * seen. It changed the hash and nothing else: every browser already
 * signed in with the old password — the intruder's included — stayed
 * signed in. Every OTHER device is now signed out; the one making the
 * change stays, so the person is not thrown out mid-save.
 */

const h = vi.hoisted(() => ({ revoked: null as unknown, updated: 0 }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1' }, sessionId: 'this-device' }) }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc', role: 'agent' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('bcryptjs', () => ({ default: { compare: () => Promise.resolve(true), hash: () => Promise.resolve('new-hash') } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: () => Promise.resolve({ password_hash: 'old' }),
      update: () => {
        h.updated++
        return Promise.resolve({})
      },
    },
    userSession: {
      updateMany: (args: unknown) => {
        h.revoked = args
        return Promise.resolve({ count: 2 })
      },
    },
  },
}))

import { POST } from './route'

describe('changing your password', () => {
  it('signs out every other device, and keeps this one', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ current_password: 'old-pass', new_password: 'new-password' }) }) as never,
    )
    expect(res.status).toBe(200)
    expect(h.updated).toBe(1)
    expect(h.revoked).toEqual({
      where: { user_id: 'u1', revoked_at: null, id: { not: 'this-device' } },
      data: { revoked_at: expect.any(Date) },
    })
  })
})
