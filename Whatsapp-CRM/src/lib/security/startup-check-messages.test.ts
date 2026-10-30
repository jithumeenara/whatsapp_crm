import { describe, expect, it } from 'vitest'
import { checkStartupEnv } from './startup-check'

/**
 * Deploy risk (security review 2026-10): an existing server whose secret is
 * short or contains a placeholder word now refuses to start. The check stays
 * as strict; the message must tell the operator exactly what is wrong and
 * what to do — by variable name, never the value.
 */
const GOOD = {
  NODE_ENV: 'production',
  NEXTAUTH_SECRET: 'k3J9vQ2mX8pL5rT1wZ7yB4nC6dF0gH2jK9sA3eU5iO8',
  ENCRYPTION_KEY: 'a'.repeat(32) + '0123456789abcdef0123456789ABCDEF',
}
const errs = (over: Record<string, string | undefined>) => checkStartupEnv({ ...GOOD, ...over }).errors.join('\n')

describe('startup check messages', () => {
  it('a short secret: says how long it is and the minimum, and how to make one', () => {
    const value = 'Zq8#kP2!vM9x' // 12 characters
    const msg = errs({ NEXTAUTH_SECRET: value })
    expect(msg).toContain('NEXTAUTH_SECRET is 12 characters long; it must be at least 32')
    expect(msg).toContain('openssl rand -hex 32')
    expect(msg).toContain('signs everyone out')
    expect(msg).not.toContain(value)
  })
  it('a placeholder word: names the word, not the value', () => {
    const value = 'Qw7Rt5Yu3Io1Pa9Sd8Fg6Hj4Kl2Zx0Cv-secret-Bn'
    const msg = errs({ NEXTAUTH_SECRET: value })
    expect(msg).toContain('NEXTAUTH_SECRET contains the placeholder word "secret"')
    expect(msg).not.toContain(value)
  })
  it('AUTH_SECRET gets the same detail', () => {
    expect(errs({ AUTH_SECRET: 'abc' })).toContain('AUTH_SECRET is 3 characters long; it must be at least 32')
  })
  it('a bad ENCRYPTION_KEY: says the format, and warns not to replace a working one', () => {
    const msg = errs({ ENCRYPTION_KEY: 'not-hex' })
    expect(msg).toContain('ENCRYPTION_KEY is 7 characters long; it must be exactly 64 hexadecimal characters')
    expect(msg).toContain('stored tokens unreadable')
    expect(msg).not.toContain('not-hex')
  })
  it('a missing variable says it is not set', () => {
    expect(errs({ NEXTAUTH_SECRET: undefined })).toContain('NEXTAUTH_SECRET is not set')
  })
})
