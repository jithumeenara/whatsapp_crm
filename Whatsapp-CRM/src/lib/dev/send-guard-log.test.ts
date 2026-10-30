import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A stopped send was logged with its full URL, with only `access_token=`
 * masked. Telegram carries the bot token in the path (/bot<token>/…) and
 * other providers put keys in the query, so a staging server's log held
 * live credentials. The log line names the provider and host only.
 */

const BOT_TOKEN = '7712345678:AAH-live-bot-token-do-not-log'
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('a stopped send never writes a credential to the log', () => {
  it('Telegram bot token in the path stays out of the log', async () => {
    vi.stubEnv('APP_ENV', 'staging')
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('{}'))) as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { installDevSendGuard } = await import('./send-guard')
    installDevSendGuard()

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      body: JSON.stringify({ chat_id: 12345, text: 'hi' }),
    })

    const logged = warn.mock.calls.flat().join('\n')
    expect(logged).toContain('api.telegram.org')
    expect(logged).not.toContain(BOT_TOKEN)
    expect(logged).not.toContain('/bot')
  })

  it('keys in the query string stay out of the log', async () => {
    vi.stubEnv('APP_ENV', 'preview')
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('{}'))) as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { installDevSendGuard } = await import('./send-guard')
    installDevSendGuard()

    await fetch('https://api.msg91.com/api/v2/sendsms?authkey=live-msg91-key&mobiles=919847012345', { method: 'POST', body: '{}' })

    const logged = warn.mock.calls.flat().join('\n')
    expect(logged).not.toContain('live-msg91-key')
    expect(logged).not.toContain('919847012345')
  })
})
