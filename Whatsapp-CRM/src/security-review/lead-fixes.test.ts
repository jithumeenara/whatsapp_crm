/**
 * Independent security review (A7) — the lead's own fixes:
 *  - 75d27a3: V060-a/b/c hardening of integration secrets;
 *  - send-guard logging: a stopped request is logged as provider + host only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAuthConfig, sealAuthConfig } from '@/lib/integration-secrets'
import { redactIntegration } from '@/lib/integration-fetch'
import { encrypt, isSealed } from '@/lib/whatsapp/encryption'

describe('V-060 follow-ups', () => {
  it('a row stored as { sealed: "<plain JSON>" } during the round-7 window neither throws, leaks, nor works as credentials', () => {
    const legacy = { sealed: JSON.stringify({ username: 'k', password: 'clear-secret' }) }
    expect(() => openAuthConfig(legacy)).not.toThrow()
    const out = JSON.stringify(redactIntegration({ id: 'i', auth_config: legacy }))
    expect(out).not.toContain('clear-secret')
    expect(out).not.toContain('sealed')
    // and the next save seals the whole thing
    expect(isSealed(sealAuthConfig(legacy)!.sealed)).toBe(true)
  })
  it('a sealed value that decrypts to non-JSON fails closed and its plaintext is not logged', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const v = { sealed: encrypt('password=plain-not-json') }
    expect(openAuthConfig(v)).toBeNull()
    expect(err.mock.calls.flat().join(' ')).not.toContain('plain-not-json')
    expect(redactIntegration({ id: 'i', auth_config: v }).auth_config).toBeNull()
    err.mockRestore()
  })
  it('a ciphertext with a flipped tag fails closed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const good = encrypt(JSON.stringify({ token: 't' }))
    const bad = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0')
    expect(openAuthConfig({ sealed: bad })).toBeNull()
    vi.restoreAllMocks()
  })
})

describe('dev guard log lines carry no credential', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })
  it('Meta write, Telegram provider write and a userinfo URL log the host only', async () => {
    vi.stubEnv('APP_ENV', 'staging')
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('{}'))) as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { installDevSendGuard } = await import('@/lib/dev/send-guard')
    installDevSendGuard()
    await fetch('https://graph.facebook.com/v21.0/123/subscribed_apps?access_token=EAAlive-meta-token', { method: 'POST' })
    await fetch('https://api.telegram.org/bot77:AAlive-tg-token/setWebhook?url=https://x', { method: 'POST' })
    await fetch('https://graph.facebook.com/v21.0/1/messages?access_token=EAAlive2', { method: 'POST', body: '{"to":"919800000001"}' })
    const logged = warn.mock.calls.flat().join('\n')
    for (const secret of ['EAAlive-meta-token', 'AAlive-tg-token', 'EAAlive2', '919800000001', 'subscribed_apps', 'setWebhook']) {
      expect(logged, secret).not.toContain(secret)
    }
    expect(logged).toContain('graph.facebook.com')
    expect(globalThis.fetch).toBeDefined()
  })
})
