import { describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10, A4-04): an outgoing webhook's signing
 * secret was stored as plain text, so a database backup was enough to
 * forge "record.created" calls to every customer's receiver. It is now
 * sealed at rest; the person still sees it once, in plain, on creation.
 */

const h = vi.hoisted(() => ({ stored: null as string | null }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'a1', userId: 'u1', role: 'admin' }) }
})
// No DNS in tests: a public URL is taken as public.
vi.mock('@/lib/net/safe-fetch', async () => ({
  ...(await vi.importActual<typeof import('@/lib/net/safe-fetch')>('@/lib/net/safe-fetch')),
  assertPublicUrl: async (u: string) => new URL(u),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    webhook: {
      create: async (a: { data: { signing_secret: string } }) => {
        h.stored = a.data.signing_secret
        return { id: 'w1' }
      },
    },
    dataTable: { findFirst: async () => null },
  },
}))

import { POST } from './route'
import { decrypt } from '@/lib/whatsapp/encryption'

describe('outgoing webhook signing secret', () => {
  it('is shown once in plain and stored sealed', async () => {
    const res = await POST(
      new Request('http://x/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({ name: 'n', url: 'https://example.com/h', events: ['record.created'] }),
      }),
    )
    expect(res.status).toBe(201)
    const { signing_secret } = (await res.json()) as { signing_secret: string }
    expect(signing_secret).toMatch(/^[0-9a-f]{64}$/)
    expect(h.stored).not.toBe(signing_secret)
    expect(decrypt(h.stored!)).toBe(signing_secret)
  })
})
