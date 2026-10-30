import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Two weaknesses in checking a sign-in code:
 *
 *  - The five-tries limit was read, then the try was counted later. A
 *    burst of guesses sent together all read "0 tries so far", so the
 *    limit capped nothing for anyone who sent them at once.
 *  - An authenticator code that had just signed somebody in was good for
 *    another sign-in for the rest of its 90-second window — a code seen
 *    over a shoulder or through a phishing page could be used again.
 */

type Ch = { id: string; user_id: string; purpose: string; method: string; code_hash: string | null; pending_phone: null; verified: boolean; consumed_at: null; attempts: number; expires_at: Date }
const h = vi.hoisted(() => ({ challenges: new Map<string, Ch>(), compares: 0, secret: '' }))
const tick = () => new Promise((r) => setTimeout(r, 0))

vi.mock('bcryptjs', () => ({
  default: {
    compare: async () => {
      h.compares++
      await tick()
      return false
    },
    hash: async () => 'hash',
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => h.secret }))
vi.mock('@/lib/messaging/channels/sms', () => ({ sendSmsText: () => Promise.resolve() }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage: () => Promise.resolve() }))
vi.mock('@/lib/whatsapp/template-row-guard', () => ({ isMessageTemplate: () => true }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({ resolveWhatsAppConfig: () => Promise.resolve({}), NoWhatsAppConfigError: class {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    mfaChallenge: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        await tick()
        const c = h.challenges.get(where.id)
        return c ? { ...c } : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        await tick()
        const c = h.challenges.get(where.id)!
        if (data.attempts && typeof data.attempts === 'object') c.attempts++
        else Object.assign(c, data)
        return c
      },
      updateMany: async ({ where, data }: { where: { id: string; attempts?: { lt: number } }; data: Record<string, unknown> }) => {
        await tick()
        const c = h.challenges.get(where.id)
        if (!c || (where.attempts && !(c.attempts < where.attempts.lt))) return { count: 0 }
        if (data.attempts && typeof data.attempts === 'object') c.attempts++
        else Object.assign(c, data)
        return { count: 1 }
      },
    },
    user: { findUnique: () => Promise.resolve({ totp_secret: 'enc' }) },
  },
}))

import { verifyChallenge } from './mfa'
import { generateTotpSecret } from './totp'

function challenge(id: string, over: Partial<Ch> = {}) {
  h.challenges.set(id, {
    id, user_id: 'u1', purpose: 'login', method: 'sms', code_hash: 'x', pending_phone: null,
    verified: false, consumed_at: null, attempts: 0, expires_at: new Date(Date.now() + 60_000), ...over,
  })
}

function totpNow(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const d = crypto.createHmac('sha1', key).update(buf).digest()
  const o = d[d.length - 1] & 0xf
  return String((((d[o] & 0x7f) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) % 1_000_000).padStart(6, '0')
}

describe('checking a sign-in code', () => {
  beforeEach(() => {
    h.challenges.clear()
    h.compares = 0
  })

  it('allows five guesses per code even when twenty arrive at once', async () => {
    challenge('c1')
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyChallenge('c1', '123456')))
    expect(results.every((r) => !r.ok)).toBe(true)
    expect(h.compares).toBeLessThanOrEqual(5)
    expect(h.challenges.get('c1')!.attempts).toBe(5)
  })

  it('accepts an authenticator code once — a second sign-in with the same code is refused', async () => {
    h.secret = generateTotpSecret()
    const code = totpNow(h.secret)
    challenge('t1', { method: 'totp', code_hash: null, user_id: 'replay-user' })
    challenge('t2', { method: 'totp', code_hash: null, user_id: 'replay-user' })
    expect((await verifyChallenge('t1', code)).ok).toBe(true)
    expect((await verifyChallenge('t2', code)).ok).toBe(false)
  })
})
