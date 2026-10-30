import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashIp } from './tokens'

/**
 * Bug (security audit 2026-10, A4-09): with no server secret set, hashIp
 * keyed its HMAC with the literal 'webchat' — anyone with the source could
 * hash all 2^32 IPv4 addresses and reverse every stored visitor IP. With
 * no secret it now stores no IP at all (fail closed).
 */
describe('visitor IP hash', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('stores nothing when the server has no secret', () => {
    vi.stubEnv('NEXTAUTH_SECRET', '')
    vi.stubEnv('AUTH_SECRET', '')
    vi.stubEnv('ENCRYPTION_KEY', '')
    expect(hashIp('203.0.113.7')).toBeNull()
  })

  it('is keyed by the server secret when there is one', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'a-real-server-secret')
    const one = hashIp('203.0.113.7')
    expect(one).toMatch(/^[0-9a-f]{32}$/)
    vi.stubEnv('NEXTAUTH_SECRET', 'another-secret')
    expect(hashIp('203.0.113.7')).not.toBe(one)
  })
})
