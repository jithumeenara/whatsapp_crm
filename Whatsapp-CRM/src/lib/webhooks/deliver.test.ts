import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): outgoing webhooks — and a call-forward
 * URL — were checked by a string regex only. `https://[::ffff:7f00:1]/`,
 * `https://[fd00::1]/`, 100.64.0.0/10 and any public name resolving to a
 * private address (DNS rebinding) passed, and delivery went through plain
 * fetch: the server could be made to POST into its own network.
 */

const h = vi.hoisted(() => ({ hooks: [] as Array<{ id: string; url: string; signing_secret: string }>, updates: 0 }))
vi.mock('@/lib/db', () => ({
  prisma: {
    webhook: {
      findMany: async () => h.hooks,
      update: async () => {
        h.updates++
        return { failure_count: 1 }
      },
    },
  },
}))

import { checkWebhookUrl, dispatchWebhooks, validateWebhookUrl } from './deliver'
import { encrypt } from '@/lib/whatsapp/encryption'

describe('outgoing webhook URL — internal addresses refused when saved', () => {
  for (const url of [
    'https://[::ffff:7f00:1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://[fd00::1]/hook',
    'https://[fe80::1]/hook',
    'https://100.64.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://2130706433/hook',
    'https://localhost./hook',
    'https://foo.localhost/hook',
  ]) {
    it(`refuses ${url}`, () => {
      expect(() => validateWebhookUrl(url)).toThrow()
    })
  }

  it('refuses a public-looking name that resolves inside (checked with DNS)', async () => {
    await expect(checkWebhookUrl('https://127.0.0.1.nip.io/hook', { resolve: async () => ['127.0.0.1'] })).rejects.toThrow()
  })

  it('accepts a public https URL', async () => {
    expect(validateWebhookUrl('https://hooks.example.com/x')).toBe('https://hooks.example.com/x')
    await expect(checkWebhookUrl('https://hooks.example.com/x', { resolve: async () => ['93.184.216.34'] })).resolves.toBe(
      'https://hooks.example.com/x',
    )
  })
})

describe('outgoing webhook delivery', () => {
  const realFetch = globalThis.fetch
  const network = vi.fn(async () => new Response('ok'))
  beforeEach(() => {
    network.mockClear()
    globalThis.fetch = network as unknown as typeof fetch
    h.updates = 0
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('never POSTs to an internal address, even one stored before this check', async () => {
    h.hooks = [{ id: 'w1', url: 'https://[::ffff:7f00:1]/admin', signing_secret: encrypt('s') }]
    dispatchWebhooks('a1', 'record.created', 't1', { id: 'r', data: {}, created_at: '', updated_at: '' }, 'T')
    await new Promise((r) => setTimeout(r, 50))
    expect(network).not.toHaveBeenCalled()
    // Refused at once (no retries) and counted as a failed delivery.
    expect(h.updates).toBe(1)
  })
})
