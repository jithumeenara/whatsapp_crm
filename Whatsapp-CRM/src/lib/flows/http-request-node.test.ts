import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@/lib/net/safe-fetch', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...real, safeFetch: vi.fn(real.safeFetch) }
})

import { safeFetch, SsrfBlockedError } from '@/lib/net/safe-fetch'
import { runHttpNodeRequest } from './http-request-node'

const spy = vi.mocked(safeFetch)

// Security audit A9-01: a chatbot/flow "HTTP request" step fetched any URL
// its author typed with the plain fetch, followed redirects, and saved the
// reply into a flow variable a later step can message out — a full-read
// SSRF into the server's own network.
describe('runHttpNodeRequest', () => {
  const globalFetch = vi.fn(async () => new Response('secret', { status: 200 }))
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', globalFetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:3000/api/version', 'http://[::1]/'])(
    'refuses %s',
    async (url) => {
      await expect(runHttpNodeRequest({ method: 'GET', url, headers: {} })).rejects.toThrow()
      expect(globalFetch).not.toHaveBeenCalled()
    },
  )

  it('gives up when the central client refuses a hop', async () => {
    spy.mockRejectedValueOnce(new SsrfBlockedError('address'))
    await expect(runHttpNodeRequest({ method: 'GET', url: 'https://public.example/', headers: {} })).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('still calls a public API, with a timeout and a size cap', async () => {
    spy.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    const r = await runHttpNodeRequest({ method: 'POST', url: 'https://api.example:8080/hook', headers: {}, body: '{}' })
    expect(r).toEqual({ status: 200, ok: true, text: '{"ok":true}' })
    expect(globalFetch).not.toHaveBeenCalled()
    expect(spy.mock.calls[0][2]).toMatchObject({ allowedPorts: [80, 443, 8080], maxBytes: expect.any(Number), timeoutMs: expect.any(Number) })
    expect(spy.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' })
  })
})
