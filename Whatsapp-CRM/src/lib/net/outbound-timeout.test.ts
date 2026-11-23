import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OUTBOUND_TIMEOUT_MS,
  SLOW_OUTBOUND_TIMEOUT_MS,
  outboundTimeoutFor,
  withOutboundTimeout,
} from './outbound-timeout'

/**
 * A provider that stops answering must not hang a send, a job or a
 * screen for ever: every outgoing request without its own signal gets a
 * deadline, and a caller's own signal is never replaced.
 */
describe('which requests get a deadline', () => {
  it('an ordinary Graph call gets the default deadline', () => {
    expect(outboundTimeoutFor('https://graph.facebook.com/v24.0/123/messages', { method: 'POST', body: '{}' }))
      .toBe(DEFAULT_OUTBOUND_TIMEOUT_MS)
  })

  it('model hosts and uploads get the longer deadline', () => {
    expect(outboundTimeoutFor('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')).toBe(SLOW_OUTBOUND_TIMEOUT_MS)
    expect(outboundTimeoutFor(new URL('https://api.anthropic.com/v1/messages'))).toBe(SLOW_OUTBOUND_TIMEOUT_MS)
    const form = new FormData()
    form.append('file', new Blob(['x']))
    expect(outboundTimeoutFor('https://graph.facebook.com/v24.0/123/media', { method: 'POST', body: form })).toBe(SLOW_OUTBOUND_TIMEOUT_MS)
  })

  it("a caller's own signal, the app calling itself and relative URLs are left alone", () => {
    expect(outboundTimeoutFor('https://graph.facebook.com/x', { signal: AbortSignal.timeout(5000) })).toBeNull()
    expect(outboundTimeoutFor('http://localhost:3000/api/x')).toBeNull()
    expect(outboundTimeoutFor('http://127.0.0.1:3000/api/x')).toBeNull()
    expect(outboundTimeoutFor('/api/x')).toBeNull()
    expect(outboundTimeoutFor(new Request('https://graph.facebook.com/x'))).toBeNull()
  })
})

describe('the wrapped fetch', () => {
  it('adds an abort signal only when the caller gave none', async () => {
    const real = vi.fn(async () => new Response('ok'))
    const f = withOutboundTimeout(real as unknown as typeof fetch)
    await f('https://api.razorpay.com/v1/payment_links', { method: 'POST', body: '{}' })
    const [, init] = real.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.method).toBe('POST')

    const own = new AbortController().signal
    await f('https://api.razorpay.com/v1/x', { signal: own })
    expect((real.mock.calls[1] as unknown as [string, RequestInit])[1].signal).toBe(own)
  })

  it('a provider that never answers fails with a timeout instead of hanging', async () => {
    vi.useFakeTimers()
    // AbortSignal.timeout runs on Node's own clock, which fake timers do
    // not drive; the same signal built from a fake-timer setTimeout.
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const c = new AbortController()
      setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
      return c.signal
    })
    try {
      const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
      const f = withOutboundTimeout(hang as unknown as typeof fetch)
      const p = f('https://graph.facebook.com/v24.0/me')
      const settled = expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(DEFAULT_OUTBOUND_TIMEOUT_MS + 10)
      await settled
    } finally {
      spy.mockRestore()
      vi.useRealTimers()
    }
  })
})
