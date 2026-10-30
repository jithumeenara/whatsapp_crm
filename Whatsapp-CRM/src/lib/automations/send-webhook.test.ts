import { afterEach, describe, expect, it, vi } from 'vitest'
import { postAutomationWebhook } from './send-webhook'

// The step used to call fetch(cfg.url) directly: an automation could
// POST to anything the server can reach, and its log showed the status
// code or connection error that came back — a port scanner for the
// server's own network.
afterEach(() => vi.unstubAllGlobals())

describe('the send-webhook step', () => {
  for (const url of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.1/', 'gopher://example.com/']) {
    it(`refuses ${url}`, async () => {
      const spy = vi.fn(async () => new Response('', { status: 200 }))
      vi.stubGlobal('fetch', spy)
      await expect(postAutomationWebhook(url, {}, '{}')).rejects.toThrow()
      expect(spy).not.toHaveBeenCalled()
    })
  }
})
