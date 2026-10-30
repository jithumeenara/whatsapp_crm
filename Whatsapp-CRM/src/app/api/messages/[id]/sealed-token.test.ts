import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sealSecret } from '@/lib/whatsapp/encryption'

/**
 * Facebook / Instagram page tokens are sealed (encrypted) on save since
 * A8-09. The unsend path read the column as it was and sent the
 * ciphertext to the Graph API as the access token, so "delete for
 * everyone" failed on every sealed row.
 */

const h = vi.hoisted(() => ({ channel: 'instagram' as string, stored: '' }))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'me' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'admin' }) }
})
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: () => Promise.resolve() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findFirst: () =>
        Promise.resolve({ id: 'm1', message_id: 'mid-1', conversation: { account_id: 'acc', channel: h.channel, assigned_agent_id: 'me' } }),
    },
    $executeRaw: () => Promise.resolve(1),
    $queryRaw: () => {
      const p = Promise.resolve([{ access_token: h.stored }])
      return { catch: () => p, then: (r: (v: unknown) => unknown) => p.then(r) }
    },
  },
}))

import { DELETE } from './route'

const del = () => DELETE(new Request('http://x', { method: 'DELETE' }) as never, { params: Promise.resolve({ id: 'm1' }) })

describe('DELETE /api/messages/[id] with a sealed page token', () => {
  let urls: string[] = []
  beforeEach(() => {
    urls = []
    h.stored = sealSecret('real-page-token')!
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(String(url)); return new Response('{}', { status: 200 }) }))
  })

  for (const channel of ['instagram', 'facebook']) {
    it(`${channel}: the Graph call carries the decrypted token, not the ciphertext`, async () => {
      h.channel = channel
      expect((await del()).status).toBe(200)
      expect(urls).toHaveLength(1)
      const token = new URL(urls[0]).searchParams.get('access_token')
      expect(token).toBe('real-page-token')
    })
  }
})
