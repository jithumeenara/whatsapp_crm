import { describe, expect, it, vi } from 'vitest'
import { moveGraphToken, withGraphTokenHeader } from './graph-token-header'

/** A Meta token must never travel in the address, where logs and error messages copy it. */
describe('moveGraphToken', () => {
  it('moves access_token from the Graph URL into an Authorization header, keeping the rest', () => {
    const m = moveGraphToken('https://graph.facebook.com/v24.0/123?fields=name&access_token=EAAsecret&appsecret_proof=abc', { method: 'GET' })!
    expect(m.url).toBe('https://graph.facebook.com/v24.0/123?fields=name&appsecret_proof=abc')
    expect(new Headers(m.init.headers).get('authorization')).toBe('Bearer EAAsecret')
    expect(m.init.method).toBe('GET')
  })

  it('leaves other hosts, token-less calls and calls with their own Authorization alone', () => {
    expect(moveGraphToken('https://example.com/x?access_token=t')).toBeNull()
    expect(moveGraphToken('https://graph.facebook.com/v24.0/me?fields=id')).toBeNull()
    expect(moveGraphToken('https://graph.facebook.com/v24.0/me?access_token=t', { headers: { Authorization: 'Bearer other' } })).toBeNull()
    expect(moveGraphToken(new Request('https://graph.facebook.com/v24.0/me?access_token=t'))).toBeNull()
  })

  it('the wrapped fetch sends the cleaned URL', async () => {
    const real = vi.fn(async () => new Response('{}'))
    await withGraphTokenHeader(real as unknown as typeof fetch)('https://graph.facebook.com/v24.0/me?access_token=EAAx')
    const [url, init] = real.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('EAAx')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer EAAx')
  })
})
