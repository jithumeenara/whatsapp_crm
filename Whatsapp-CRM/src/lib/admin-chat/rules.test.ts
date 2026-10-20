import { describe, expect, it } from 'vitest'
import {
  auditHash,
  isKeyword,
  isStop,
  lockAfterFailure,
  localNow,
  maskSensitive,
  parseVerifyCode,
  sessionExpiry,
  windowCheck,
} from './rules'
import { generateTotpSecret, matchTotpStep } from '@/lib/auth/totp'
import crypto from 'crypto'

const member = {
  valid_from: new Date('2026-10-01T00:00:00Z'),
  valid_until: new Date('2026-10-31T00:00:00Z'),
  allowed_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  start_minute: 9 * 60,
  end_minute: 18 * 60,
}

describe('when an admin may start a session (business time zone)', () => {
  it('a Tuesday 10:00 in Kolkata is inside', () => {
    // 04:30 UTC = 10:00 IST
    const local = localNow('Asia/Kolkata', new Date('2026-10-20T04:30:00Z'))
    expect(local).toEqual({ day: 'tue', minutes: 600, date: '2026-10-20' })
    expect(windowCheck(member, local)).toEqual({ ok: true })
  })

  it('outside the hours, on a day off, before and after the dates', () => {
    expect(windowCheck(member, localNow('Asia/Kolkata', new Date('2026-10-20T13:00:00Z')))).toEqual({ ok: false, reason: 'hours' }) // 18:30
    expect(windowCheck(member, localNow('Asia/Kolkata', new Date('2026-10-25T05:00:00Z')))).toEqual({ ok: false, reason: 'day' }) // Sunday
    expect(windowCheck(member, localNow('Asia/Kolkata', new Date('2026-09-30T05:00:00Z')))).toEqual({ ok: false, reason: 'not_started' })
    expect(windowCheck(member, localNow('Asia/Kolkata', new Date('2026-11-02T05:00:00Z')))).toEqual({ ok: false, reason: 'expired' })
  })

  it('the last valid day counts in the business zone, not UTC', () => {
    // 31 Oct 23:00 IST is still 31 Oct there (17:30 UTC) — a Saturday, but after hours;
    // 31 Oct 10:00 IST is inside.
    expect(windowCheck(member, localNow('Asia/Kolkata', new Date('2026-10-31T04:30:00Z')))).toEqual({ ok: true })
  })
})

describe('session timeouts', () => {
  const settings = { idle_minutes: 15, max_minutes: 60 }
  const now = new Date('2026-10-20T10:00:00Z')
  const min = (n: number) => new Date(now.getTime() - n * 60_000)

  it('an active session ends after 15 idle minutes or 60 in all', () => {
    expect(sessionExpiry({ state: 'active', started_at: min(30), last_activity_at: min(5), code_expires_at: null }, settings, now)).toBeNull()
    expect(sessionExpiry({ state: 'active', started_at: min(30), last_activity_at: min(16), code_expires_at: null }, settings, now)).toBe('idle')
    expect(sessionExpiry({ state: 'active', started_at: min(61), last_activity_at: min(1), code_expires_at: null }, settings, now)).toBe('max')
  })

  it('a code request expires', () => {
    expect(sessionExpiry({ state: 'awaiting_code', started_at: null, last_activity_at: min(1), code_expires_at: min(0.1) }, settings, now)).toBe('code_timeout')
  })
})

describe('words in the chat', () => {
  it('the keyword, any case, nothing else around it', () => {
    expect(isKeyword('  admin ', 'ADMIN')).toBe(true)
    expect(isKeyword('admin please', 'ADMIN')).toBe(false)
  })
  it('stop words', () => {
    for (const w of ['STOP', 'logout', 'Exit', 'end']) expect(isStop(w)).toBe(true)
    expect(isStop('stop the broadcast')).toBe(false)
  })
  it('the enrolment code', () => {
    expect(parseVerifyCode('CRM-482913')).toBe('482913')
    expect(parseVerifyCode('crm 482913')).toBe('482913')
    expect(parseVerifyCode('482913')).toBeNull()
  })
})

describe('wrong codes', () => {
  it('locks for 15 minutes on the fifth failure', () => {
    const now = new Date('2026-10-20T10:00:00Z')
    expect(lockAfterFailure(4, now)).toBeNull()
    expect(lockAfterFailure(5, now)?.toISOString()).toBe('2026-10-20T10:15:00.000Z')
  })
})

describe('what may be shown in a chat', () => {
  it('masks phone numbers, Aadhaar-like numbers and emails', () => {
    expect(maskSensitive('Call 9847012345 or +91 98470 12345')).toBe('Call 98•••••345 or +91 98•••••345')
    expect(maskSensitive('Aadhaar 1234 5678 9012')).toBe('Aadhaar 12•••••012')
    expect(maskSensitive('mail asha.k@example.com')).toBe('mail a•••@example.com')
  })
  it('masks a number followed by a comma or full stop (a list)', () => {
    expect(maskSensitive('Top: Asha, 9847012345, Ravi 9847012346.')).toBe('Top: Asha, 98•••••345, Ravi 98•••••346.')
  })

  it('leaves counts, amounts and dates alone', () => {
    expect(maskSensitive('42 leads, ₹1,25,000 on 20-10-2026')).toBe('42 leads, ₹1,25,000 on 20-10-2026')
  })
})

describe('audit chain', () => {
  it('each hash depends on the one before', () => {
    const at = new Date('2026-10-20T10:00:00Z')
    const a = auditHash('genesis', { accountId: 'acc', event: 'session_started', detail: { x: 1 }, createdAt: at })
    const b = auditHash(a, { accountId: 'acc', event: 'question', detail: { q: 'hi' }, createdAt: at })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).not.toBe(auditHash('genesis', { accountId: 'acc', event: 'question', detail: { q: 'hi' }, createdAt: at }))
  })

  it('does not depend on key order (the database reorders JSON keys)', () => {
    const at = new Date('2026-10-20T10:00:00Z')
    expect(auditHash('p', { accountId: 'a', event: 'e', detail: { b: 1, a: { d: 2, c: 3 } }, createdAt: at })).toBe(
      auditHash('p', { accountId: 'a', event: 'e', detail: { a: { c: 3, d: 2 }, b: 1 }, createdAt: at }),
    )
  })
})

describe('authenticator codes work once', () => {
  it('returns the step that matched, and refuses the same step again', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-10-20T10:00:00Z')
    const step = Math.floor(now.getTime() / 30_000)
    // Compute the current code the standard way (RFC 6238).
    const key = base32(secret)
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64BE(BigInt(step))
    const h = crypto.createHmac('sha1', key).update(buf).digest()
    const o = h[h.length - 1] & 0xf
    const code = String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0')
    expect(matchTotpStep(secret, code, now, null)).toBe(step)
    expect(matchTotpStep(secret, code, now, step)).toBeNull()
    expect(matchTotpStep(secret, '000000' === code ? '111111' : '000000', now, null)).toBeNull()
  })
})

function base32(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
