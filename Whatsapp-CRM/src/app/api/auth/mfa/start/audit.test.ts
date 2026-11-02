import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sign-in screen's first step is where wrong passwords and unknown
 * emails actually arrive. Each failure is counted for the audit log with
 * its real reason; the person still sees one generic message, and the
 * email typed is never passed on in plain text.
 */

const h = vi.hoisted(() => ({ failures: [] as Array<Record<string, unknown>>, user: null as null | Record<string, unknown> }))

vi.mock('@/lib/audit/aggregate', () => ({
  recordLoginFailure: (a: Record<string, unknown>) => h.failures.push(a),
  recordRateLimited: () => {},
}))
vi.mock('@/lib/auth/mfa', () => ({ createChallenge: () => Promise.resolve({ challengeId: 'c1' }) }))
vi.mock('bcryptjs', () => ({ default: { compare: (p: string) => Promise.resolve(p === 'right') } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findFirst: () => Promise.resolve(h.user), findUnique: () => Promise.resolve(h.user) },
    profile: { findUnique: () => Promise.resolve({ account_id: 'acc-1' }) },
  },
}))

import { POST } from './route'
import { emailHmac } from '@/lib/audit/pepper'

const post = (email: string, password: string) =>
  POST(new Request('http://x/api/auth/mfa/start', { method: 'POST', body: JSON.stringify({ email, password }) }) as never)

describe('failed sign-ins are recorded without the email in plain text', () => {
  beforeEach(() => {
    h.failures = []
    h.user = null
  })

  it('an unknown email: generic 401 to the person, unknown_user to the log', async () => {
    const res = await post('Who.Is@Example.com', 'x')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid email or password' })
    expect(h.failures).toHaveLength(1)
    expect(h.failures[0]).toMatchObject({ reason: 'unknown_user', user: null })
  })

  it('a wrong password for a known user: bad_password, against that user and their team', async () => {
    h.user = { id: 'u-1', password_hash: 'h', mfa_method: 'disabled' }
    const res = await post('anu@example.com', 'wrong')
    expect(res.status).toBe(401)
    expect(h.failures[0]).toMatchObject({ reason: 'bad_password', user: { id: 'u-1', accountId: 'acc-1' } })
  })

  it('a right password records nothing', async () => {
    h.user = { id: 'u-1', password_hash: 'h', mfa_method: 'disabled' }
    expect((await post('anu@example.com', 'right')).status).toBe(200)
    expect(h.failures).toHaveLength(0)
  })
})

describe('what the counter turns the typed email into', async () => {
  const real = await vi.importActual<typeof import('@/lib/audit/aggregate')>('@/lib/audit/aggregate')
  it('keeps only the HMAC', () => {
    real.__resetAggregatesForTests()
    real.recordLoginFailure({ ip: '203.0.113.5', reason: 'unknown_user', typed: 'Who.Is@Example.com' })
    const events = real.toEvents(real.__bucketsForTests())
    const text = JSON.stringify(events)
    expect(text).not.toMatch(/who\.is|example\.com/i)
    expect(text).toContain(emailHmac('who.is@example.com'))
  })
})
