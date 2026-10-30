import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@/lib/net/safe-fetch', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...real, safeFetch: vi.fn(real.safeFetch) }
})

import { safeFetch, SsrfBlockedError } from '@/lib/net/safe-fetch'
import { fetchPageText } from './web-extract'

const spy = vi.mocked(safeFetch)

// Security audit A9-02: a knowledge-base website link was fetched with the
// global fetch and redirect: 'follow', so a public page answering
// 302 -> 169.254.169.254 had the metadata service's answer saved as
// "knowledge" and shown back. It must go through the central safeFetch.
describe('fetchPageText', () => {
  const globalFetch = vi.fn(async () => new Response('ami-id\ninstance-id\niam/', { status: 200 }))
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', globalFetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('never uses the plain global fetch', async () => {
    spy.mockResolvedValueOnce(new Response('<p>hi</p>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await fetchPageText('https://public.example/page')
    expect(globalFetch).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][2]).toMatchObject({ maxBytes: expect.any(Number), timeoutMs: expect.any(Number) })
  })

  it('refuses the metadata address', async () => {
    await expect(fetchPageText('http://169.254.169.254/latest/meta-data/')).rejects.toThrow()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('gives up when safeFetch refuses a hop (e.g. a redirect inside the network)', async () => {
    spy.mockRejectedValueOnce(new SsrfBlockedError('address'))
    await expect(fetchPageText('https://public.example/redirects-inside')).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('still reads an ordinary page', async () => {
    spy.mockResolvedValueOnce(
      new Response('<html><title>Fees</title><body><p>Fee is 500</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const page = await fetchPageText('https://public.example/fees')
    expect(page.title).toBe('Fees')
    expect(page.text).toContain('Fee is 500')
  })
})
