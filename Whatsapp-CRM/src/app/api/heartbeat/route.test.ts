import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { decode, encode } from 'next-auth/jwt'
import { IDLE_TIMEOUT_MS } from '@/lib/auth/session-timing'

const db = vi.hoisted(() => ({
  user: { update: vi.fn(), findUnique: vi.fn() },
  userSession: { findUnique: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: db }))
vi.mock('@/lib/socket', () => ({ emitToAccount: vi.fn() }))

import { POST } from './route'

/**
 * The heartbeat re-signs the session cookie, so it is the one route that
 * can turn a dead session into a live one. It must not do that for a
 * session that is idle, revoked or past its absolute lifetime — whether
 * or not the proxy happened to stop the request first.
 */

const SECRET = 'heartbeat-test-secret'
const COOKIE = 'authjs.session-token'

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = SECRET
})
beforeEach(() => {
  db.user.update.mockResolvedValue({ went_offline_at: null, profile: { account_id: 'acc-1' } })
  db.user.findUnique.mockResolvedValue({ session_invalidated_at: null })
  db.userSession.findUnique.mockResolvedValue({ revoked_at: null })
})

let n = 0
async function beat(claims: Record<string, unknown>) {
  // A distinct user per call: the invalidation lookup is cached per user.
  const token = await encode({
    token: { id: `user-${++n}`, lastActivity: Date.now(), ...claims },
    secret: SECRET,
    salt: COOKIE,
    maxAge: 8 * 3600,
  })
  const req = new NextRequest('http://localhost:3000/api/heartbeat', {
    method: 'POST',
    headers: { cookie: `${COOKIE}=${token}` },
  })
  return POST(req)
}

async function reissued(res: Response) {
  const set = res.headers.get('set-cookie') ?? ''
  const value = /authjs\.session-token=([^;]+)/.exec(set)?.[1]
  return value ? decode({ token: value, secret: SECRET, salt: COOKIE }) : null
}

describe('POST /api/heartbeat', () => {
  it('refreshes an active session', async () => {
    const res = await beat({})
    expect(res.status).toBe(200)
    expect(await reissued(res)).toMatchObject({ lastActivity: expect.any(Number) })
  })

  it('refuses a session that is already idle', async () => {
    const res = await beat({ lastActivity: Date.now() - IDLE_TIMEOUT_MS - 60_000 })
    expect(res.status).toBe(401)
    expect(await reissued(res)).toBeNull()
  })

  it('refuses a device session that was logged out', async () => {
    db.userSession.findUnique.mockResolvedValue({ revoked_at: new Date() })
    const res = await beat({ sessionId: 'sess-1' })
    expect(res.status).toBe(401)
  })

  it('refuses a token issued before "sign out everywhere"', async () => {
    db.user.findUnique.mockResolvedValue({ session_invalidated_at: new Date(Date.now() + 60_000) })
    const res = await beat({})
    expect(res.status).toBe(401)
  })

  it('judges "sign out everywhere" by the sign-in time, not the last re-sign', async () => {
    // Signed in two hours ago, signed out everywhere an hour ago, cookie
    // kept warm since (fresh iat). It was issued before the sign-out.
    db.user.findUnique.mockResolvedValue({ session_invalidated_at: new Date(Date.now() - 3600_000) })
    const res = await beat({ authTime: Date.now() / 1000 - 2 * 3600 })
    expect(res.status).toBe(401)
  })

  it('keeps the absolute lifetime from the original sign-in, not from the last re-sign', async () => {
    // encode() stamps a fresh iat every time, so a cutoff computed from
    // iat moved forward with every heartbeat and never arrived.
    const signedInAt = Math.floor(Date.now() / 1000) - 9 * 3600
    const res = await beat({ authTime: signedInAt })
    expect(res.status).toBe(401)
  })

  it('carries the sign-in time forward on the cookie it re-issues', async () => {
    const signedInAt = Math.floor(Date.now() / 1000) - 3600
    const token = await reissued(await beat({ authTime: signedInAt }))
    expect(token?.authTime).toBe(signedInAt)
    // And a token without one gets its current iat as the anchor.
    const fresh = await reissued(await beat({}))
    expect(typeof fresh?.authTime).toBe('number')
  })
})
