import { afterEach, describe, expect, it, vi } from 'vitest'
import { tgCall } from './api'

/**
 * 20 Oct, live: agent replies on Telegram failed with "Could not reach
 * Telegram: fetch failed" while the chatbot reply a minute earlier went
 * through. Node's fetch hides the real reason in err.cause.code, which the
 * message dropped; and a connection that never opened was not tried again.
 */
function networkError(code: string) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })
}
const ok = () => new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe('reaching Telegram', () => {
  it('tries once more when the connection never opened', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(networkError('ETIMEDOUT')).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    await expect(tgCall('1:x', 'sendMessage', { chat_id: '1', text: 'hi' })).resolves.toEqual({ message_id: 5 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says why, when it still cannot connect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError('ENETUNREACH')))
    await expect(tgCall('1:x', 'sendMessage', { chat_id: '1', text: 'hi' })).rejects.toThrow(/ENETUNREACH/)
  })

  it('does not resend a message after a dropped connection — it may already be delivered', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(tgCall('1:x', 'sendMessage', { chat_id: '1', text: 'hi' })).rejects.toThrow(/ECONNRESET/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// 20 Oct, on the VPS: `curl -4` reached api.telegram.org in 0.28 s, `curl -6`
// failed at once. Whenever the address list put IPv6 first, a send failed.
describe('address order', () => {
  it('prefers IPv4 once the Telegram client is loaded', async () => {
    const dns = await import('node:dns')
    expect(dns.getDefaultResultOrder()).toBe('ipv4first')
  })
})
