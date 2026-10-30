import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@/lib/net/safe-fetch', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...real, safeFetch: vi.fn(real.safeFetch) }
})

import { safeFetch, SsrfBlockedError } from '@/lib/net/safe-fetch'
import { chatCompletionsRequest } from './openai-compatible'

const spy = vi.mocked(safeFetch)
const args = {
  apiKey: 'k',
  model: 'm',
  temperature: 0,
  maxTokens: 10,
  conversationHistory: [],
  userMessage: 'hi',
} as unknown as Parameters<typeof chatCompletionsRequest>[1]

// Security audit A9-02: a "custom" provider base_url that resolves to, or
// redirects into, the server's network must never be called with the
// account's API key attached.
describe('chatCompletionsRequest — custom base_url', () => {
  const globalFetch = vi.fn(async () => Response.json({}))
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', globalFetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('goes through safeFetch and refuses any redirect', async () => {
    spy.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] }))
    const out = await chatCompletionsRequest('https://llm.example:8000/v1', args)
    expect(JSON.stringify(out)).toContain('hello')
    expect(globalFetch).not.toHaveBeenCalled()
    expect(spy.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(spy.mock.calls[0][2]).toMatchObject({ allowedPorts: [80, 443, 8000] })
  })

  it('refuses a name the central client finds pointing inside the network', async () => {
    spy.mockRejectedValueOnce(new SsrfBlockedError('address'))
    await expect(chatCompletionsRequest('https://llm.attacker.example/v1', args)).rejects.toThrow()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('refuses a literal internal address before any request', async () => {
    await expect(chatCompletionsRequest('http://[::ffff:127.0.0.1]:11434/v1', args)).rejects.toThrow()
    expect(spy).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
