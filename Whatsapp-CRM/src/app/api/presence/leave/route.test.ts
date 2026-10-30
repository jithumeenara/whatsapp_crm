import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encode } from 'next-auth/jwt'

const db = vi.hoisted(() => ({
  user: { update: vi.fn(), findUnique: vi.fn() },
  userSession: { findUnique: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: db }))
const emit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/socket', () => ({ emitToAccount: emit }))

import { POST } from './route'

/**
 * A departure beacon from a revoked session must not mark somebody as
 * gone and tell their team — getToken() only decrypts, so the route has
 * to ask about revocation itself.
 */

const SECRET = 'presence-test-secret'
const COOKIE = 'authjs.session-token'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = SECRET
})
beforeEach(() => {
  db.user.update.mockResolvedValue({ last_seen_at: new Date(), profile: { account_id: 'acc-1' } })
  db.user.findUnique.mockResolvedValue({ session_invalidated_at: null })
  db.userSession.findUnique.mockResolvedValue({ revoked_at: null })
})

let n = 0
async function leave(claims: Record<string, unknown>) {
  const token = await encode({
    token: { id: `user-${++n}`, lastActivity: Date.now(), authTime: Date.now() / 1000, ...claims },
    secret: SECRET,
    salt: COOKIE,
    maxAge: 8 * 3600,
  })
  return POST(new NextRequest('http://localhost:3000/api/presence/leave', { method: 'POST', headers: { cookie: `${COOKIE}=${token}` } }))
}

describe('POST /api/presence/leave', () => {
  it('records a departure for a live session', async () => {
    const res = await leave({})
    expect(res.status).toBe(204)
    expect(db.user.update).toHaveBeenCalled()
    expect(emit).toHaveBeenCalled()
  })

  it('ignores a logged-out device', async () => {
    db.userSession.findUnique.mockResolvedValue({ revoked_at: new Date() })
    const res = await leave({ sessionId: 'sess-1' })
    expect(res.status).toBe(401)
    expect(db.user.update).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('ignores a token from before "sign out everywhere"', async () => {
    db.user.findUnique.mockResolvedValue({ session_invalidated_at: new Date(Date.now() - 60_000) })
    const res = await leave({ authTime: Date.now() / 1000 - 3600 })
    expect(res.status).toBe(401)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})
