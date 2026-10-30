import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): "Forward calls to" took any string. An
 * admin could point it at http://169.254.169.254/ or an internal service,
 * and every incoming WhatsApp call made this server POST there. The URL
 * is now checked like an outgoing webhook (https, public address).
 */

const h = vi.hoisted(() => ({ saved: null as Record<string, unknown> | null }))
vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'a1', userId: 'u1', role: 'admin' }) }
})
vi.mock('@/lib/net/safe-fetch', async () => ({
  ...(await vi.importActual<typeof import('@/lib/net/safe-fetch')>('@/lib/net/safe-fetch')),
  assertPublicUrl: async (u: string) => new URL(u),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    callConfig: {
      findUnique: async () => null,
      upsert: async (a: { create: Record<string, unknown> }) => {
        h.saved = a.create
        return a.create
      },
    },
  },
}))

import { PUT } from './route'

const put = (body: unknown) => PUT(new Request('http://x/api/call-config', { method: 'PUT', body: JSON.stringify(body) }))

describe('call forward URL', () => {
  beforeEach(() => {
    h.saved = null
  })

  for (const url of ['http://169.254.169.254/latest/meta-data/', 'https://127.0.0.1:8080/x', 'https://[::ffff:7f00:1]/x', 'http://agent.example.com/x', 'file:///etc/passwd']) {
    it(`refuses ${url}`, async () => {
      expect((await put({ call_forward_url: url })).status).toBe(400)
      expect(h.saved).toBeNull()
    })
  }

  it('accepts a public https address, and clearing it', async () => {
    expect((await put({ call_forward_url: 'https://your-tunnel.ngrok.dev/whatsapp' })).status).toBe(200)
    expect(h.saved?.call_forward_url).toBe('https://your-tunnel.ngrok.dev/whatsapp')
    expect((await put({ call_forward_url: '' })).status).toBe(200)
    expect(h.saved?.call_forward_url).toBeNull()
  })
})
