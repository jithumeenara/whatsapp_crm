import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Failed sign-ins and refusals are counted, not logged one by one — but
 * a spray across many accounts or an attack on one account from many
 * addresses must still be visible, and the email typed must never be
 * kept as typed (plan §5, review M1).
 */

const written = vi.hoisted(() => [] as Array<{ ctx: unknown; entry: unknown }>)
vi.mock('./write', () => ({
  audit: (ctx: unknown, entry: unknown) => {
    written.push({ ctx, entry })
    return Promise.resolve()
  },
}))

import {
  __bucketsForTests,
  __resetAggregatesForTests,
  flushAuditAggregates,
  recordDenied,
  recordLoginFailure,
  recordRateLimited,
  toEvents,
} from './aggregate'
import { emailHmac, targetHash } from './pepper'
const { prepare } = await vi.importActual<typeof import('./write')>('./write')

describe('pepper', () => {
  beforeEach(() => vi.unstubAllEnvs())
  afterEach(() => vi.unstubAllEnvs())

  it('ignores case and stray spaces, like sign-in does', () => {
    vi.stubEnv('AUDIT_PEPPER', 'p1')
    expect(emailHmac('  Anu@Example.com ')).toBe(emailHmac('anu@example.com'))
    expect(emailHmac('anu@example.com')).toMatch(/^[0-9a-f]{64}$/)
    expect(targetHash('x')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('depends on the key, so the log alone cannot be reversed', () => {
    vi.stubEnv('AUDIT_PEPPER', 'p1')
    const a = emailHmac('anu@example.com')
    vi.stubEnv('AUDIT_PEPPER', 'p2')
    expect(emailHmac('anu@example.com')).not.toBe(a)
  })

  it('falls back to a key derived from the session secret', () => {
    vi.stubEnv('AUDIT_PEPPER', '')
    vi.stubEnv('NEXTAUTH_SECRET', 's1')
    const a = emailHmac('anu@example.com')
    vi.stubEnv('NEXTAUTH_SECRET', 's2')
    expect(emailHmac('anu@example.com')).not.toBe(a)
  })
})

describe('counting failed sign-ins', () => {
  beforeEach(() => {
    __resetAggregatesForTests()
    written.length = 0
  })

  it('records an unknown email only as an HMAC, never in plain text', async () => {
    recordLoginFailure({ ip: '203.0.113.9', reason: 'unknown_user', typed: 'Secret.Person@Example.com' })
    await flushAuditAggregates()
    expect(written).toHaveLength(1)
    const text = JSON.stringify(written)
    expect(text).not.toMatch(/secret\.person/i)
    expect(text).not.toMatch(/example\.com/i)
    const entry = written[0].entry as { action: string; reason: string; outcome: string; meta: Record<string, unknown> }
    expect(entry.action).toBe('auth.login_fail')
    expect(entry.reason).toBe('unknown_user')
    expect(entry.outcome).toBe('failure')
    expect(entry.meta.email_hmac).toBe(emailHmac('secret.person@example.com'))
    expect((written[0].ctx as { accountId: unknown }).accountId).toBeNull()
  })

  it('stays clean after the sanitizer: the stored row has no email either', () => {
    recordLoginFailure({ ip: '203.0.113.9', reason: 'unknown_user', typed: 'secret.person@example.com' })
    const [ev] = toEvents(__bucketsForTests())
    const row = prepare(ev.ctx as never, ev.entry as never)
    expect(JSON.stringify(row)).not.toMatch(/secret\.person|example\.com/i)
    expect((row.meta as Record<string, unknown>).email_hmac).toBe(emailHmac('secret.person@example.com'))
    expect((row.meta as Record<string, unknown>).sample_targets).toEqual([targetHash('secret.person@example.com')])
  })

  it('a password spray from one address shows as one event with many targets', async () => {
    for (let i = 0; i < 40; i++) recordLoginFailure({ ip: '198.51.100.1', reason: 'unknown_user', typed: `user${i}@example.com` })
    await flushAuditAggregates()
    expect(written).toHaveLength(1)
    const meta = (written[0].entry as { meta: Record<string, unknown> }).meta
    expect(meta.count).toBe(40)
    expect(meta.distinct_targets).toBe(40)
    expect((meta.sample_targets as unknown[]).length).toBe(5)
    expect(meta.email_hmac).toBeUndefined()
  })

  it('one account tried from many addresses also shows by target', async () => {
    const user = { id: '22222222-2222-4222-8222-222222222222', accountId: '11111111-1111-4111-8111-111111111111' }
    for (let i = 0; i < 6; i++) recordLoginFailure({ ip: `192.0.2.${i}`, reason: 'bad_password', typed: 'a@b.co', user })
    await flushAuditAggregates()
    const byTarget = written.find((w) => (w.entry as { meta: { by: string } }).meta.by === 'target')
    expect(byTarget).toBeTruthy()
    const e = byTarget!.entry as { target: { id: string }; meta: Record<string, unknown> }
    expect(e.meta.distinct_ips).toBe(6)
    expect(e.meta.count).toBe(6)
    expect(e.target.id).toBe(user.id)
    expect((byTarget!.ctx as { accountId: string }).accountId).toBe(user.accountId)
  })

  it('a flush starts a fresh window', async () => {
    recordLoginFailure({ ip: '203.0.113.9', reason: 'bad_password', typed: 'x@y.co' })
    await flushAuditAggregates()
    await flushAuditAggregates()
    expect(written).toHaveLength(1)
  })
})

describe('refusals', () => {
  beforeEach(() => {
    __resetAggregatesForTests()
    written.length = 0
  })

  it('counts rate-limit refusals per bucket', async () => {
    for (let i = 0; i < 3; i++) recordRateLimited({ ip: '203.0.113.9', bucket: 'mfa-verify' })
    await flushAuditAggregates()
    const e = written[0].entry as { action: string; outcome: string; meta: Record<string, unknown> }
    expect(e.action).toBe('auth.rate_limited')
    expect(e.outcome).toBe('denied')
    expect(e.meta.count).toBe(3)
    expect(e.meta.bucket).toBe('mfa-verify')
  })

  it('records a 403 against the person with the role it needed and the path', async () => {
    recordDenied({ accountId: 'acc', userId: 'u1', role: 'agent', required: 'admin', path: '/api/audit/events' })
    recordDenied({ accountId: 'acc', userId: 'u1', role: 'agent', required: 'admin', path: '/api/audit/events' })
    await flushAuditAggregates()
    expect(written).toHaveLength(1)
    const { ctx, entry } = written[0] as { ctx: { actor: Record<string, unknown> }; entry: { action: string; meta: Record<string, unknown> } }
    expect(entry.action).toBe('access.denied')
    expect(ctx.actor).toMatchObject({ type: 'user', id: 'u1', role: 'agent' })
    expect(entry.meta).toMatchObject({ count: 2, required_role: 'admin', path: '/api/audit/events' })
  })
})
