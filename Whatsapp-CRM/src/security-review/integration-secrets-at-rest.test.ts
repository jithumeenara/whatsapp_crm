/**
 * Independent security review (A7, final check) — V-060: integrations.auth_config
 * sealed at rest (src/lib/integration-secrets.ts, 3f24396).
 * Passing tests assert the secure behaviour; `it.fails` documents a gap.
 */
import { describe, expect, it } from 'vitest'
import { isRedactedEcho, openAuthConfig, sealAuthConfig } from '@/lib/integration-secrets'
import { isSealed } from '@/lib/whatsapp/encryption'
import { redactIntegration } from '@/lib/integration-fetch'

const CFG = { username: 'rzp_key', password: 'rzp_secret_123' }

describe('sealing', () => {
  it('a plain config is sealed (GCM) and contains no clear-text secret', () => {
    const s = sealAuthConfig(CFG)!
    expect(isSealed(s.sealed)).toBe(true)
    expect(JSON.stringify(s)).not.toContain('rzp_secret_123')
    expect(openAuthConfig(s)).toEqual(CFG)
  })
  it('sealing twice does not double-wrap', () => {
    const s = sealAuthConfig(CFG)!
    expect(sealAuthConfig(s)).toEqual(s)
  })
  it('legacy plain rows still open; null stays null', () => {
    expect(openAuthConfig(CFG)).toEqual(CFG)
    expect(openAuthConfig(null)).toBeNull()
    expect(sealAuthConfig(null)).toBeNull()
  })
  it('the redacted echo the screen sends back is recognised (stored credentials kept)', () => {
    expect(isRedactedEcho({ username: 'rzp_key', has_secret: true })).toBe(true)
    expect(isRedactedEcho(CFG)).toBe(false)
    expect(isRedactedEcho(null)).toBe(false)
  })

  // GAP (LOW): sealAuthConfig passes through ANY object with a string
  // `sealed` field, so a client that POSTs/PATCHes
  // auth_config: { sealed: '{"username":"k","password":"s"}' } stores the
  // secret in clear text — and openStoredSecret returns a non-GCM string as
  // is, so it works as credentials. Fix: pass through only when
  // isSealed(cfg.sealed); otherwise seal JSON.stringify(cfg) (or refuse).
  it('a client-supplied { sealed: <plain JSON> } is still encrypted at rest', () => {
    const s = sealAuthConfig({ sealed: JSON.stringify(CFG) })!
    expect(isSealed(s.sealed)).toBe(true)
  })
})

describe('what leaves the server', () => {
  it('redactIntegration never returns the secret from a sealed row', () => {
    const out = redactIntegration({ id: 'i', auth_config: sealAuthConfig(CFG) })
    expect(JSON.stringify(out)).not.toContain('rzp_secret_123')
    expect(JSON.stringify(out)).not.toContain('sealed')
    expect(out.auth_config).toEqual({ username: 'rzp_key', has_secret: true })
  })
  // GAP (LOW): a sealed config that opens to a non-object (an array or a
  // string saved through the API) makes openAuthConfig return null, and
  // redactIntegration then returns the row unchanged — the { sealed }
  // ciphertext goes to every member who can list integrations. Fix:
  // redactIntegration should return auth_config: null (or {has_secret})
  // whenever it cannot open the value.
  it('the sealed blob is never sent to a client, even when it does not open to an object', () => {
    const out = redactIntegration({ id: 'i', auth_config: sealAuthConfig(['x']) })
    expect(JSON.stringify(out)).not.toContain('sealed')
  })
})

describe('corrupted sealed value', () => {
  const corrupt = { sealed: '0123456789abcdef01234567:deadbeef:0123456789abcdef0123456789abcdef' }
  // GAP (LOW): openAuthConfig throws (GCM auth failure / JSON.parse) on a
  // corrupted or wrong-key value. Callers: GET /api/integrations maps every
  // row through redactIntegration, so ONE bad row turns the whole list
  // into a 500; integrations/[id]/sync returns the raw error message
  // (crypto or JSON.parse text, which can quote part of the decrypted
  // plaintext) to the client with 502 and stores it in error_message.
  // No stack trace is returned. Fix: catch inside openAuthConfig, log the
  // integration id, return null (fail closed: "credentials missing").
  it('a corrupted sealed value fails closed (null), it does not throw', () => {
    expect(() => openAuthConfig(corrupt)).not.toThrow()
  })
  it('…and never reveals a secret while failing', () => {
    try {
      openAuthConfig(corrupt)
    } catch (err) {
      expect(String((err as Error).message)).not.toMatch(/rzp_secret|password/)
    }
  })
})
