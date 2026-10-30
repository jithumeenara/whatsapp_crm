import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Turning two-factor OFF asks for the password again, so that a browser
 * left signed in cannot quietly remove it. Setting up a NEW method did
 * not ask anything — and replaced the existing one. Anybody at an
 * unattended, signed-in browser could swap the owner's authenticator for
 * their own: the owner is locked out, the intruder holds the second
 * factor. Replacing a method now means disabling first (password).
 */

const h = vi.hoisted(() => ({ method: 'totp', writes: 0, challenges: 0 }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: `u-${Math.random()}` } }) }))
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:') } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => s }))
vi.mock('@/lib/auth/mfa', () => ({
  createChallenge: () => {
    h.challenges++
    return Promise.resolve({ challengeId: 'c', method: 'sms' })
  },
  verifyChallenge: () =>
    Promise.resolve({ ok: true, challenge: { purpose: 'enroll', user_id: 'x', method: 'sms', pending_phone: '+1' } }),
}))
vi.mock('@/lib/auth/totp', () => ({
  generateTotpSecret: () => 'SECRET',
  buildOtpauthUri: () => 'otpauth://',
  verifyTotp: () => true,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: () => Promise.resolve({ email: 'a@b.c', mfa_method: h.method }),
      update: () => {
        h.writes++
        return Promise.resolve({})
      },
    },
  },
}))

import { POST as start } from './start/route'
import { POST as confirm } from './confirm/route'

const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never

describe('setting up two-factor', () => {
  beforeEach(() => {
    h.writes = 0
    h.challenges = 0
  })

  it('cannot replace a method that is already on', async () => {
    h.method = 'totp'
    expect((await start(req({ method: 'totp' }))).status).toBe(409)
    expect((await start(req({ method: 'sms', phone: '+15550001111' }))).status).toBe(409)
    expect((await confirm(req({ method: 'totp', secret: 'ATTACKER', code: '123456' }))).status).toBe(409)
    expect(h.writes).toBe(0)
    expect(h.challenges).toBe(0)
  })

  it('works as before when two-factor is off', async () => {
    h.method = 'disabled'
    expect((await start(req({ method: 'totp' }))).status).toBe(200)
    expect((await confirm(req({ method: 'totp', secret: 'SECRET', code: '123456' }))).status).toBe(200)
    expect(h.writes).toBe(1)
  })
})
