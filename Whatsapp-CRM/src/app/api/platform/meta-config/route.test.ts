import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The platform Meta App (Embedded Signup for every workspace on the
 * server) was guarded by requireRole('owner') — the owner of ANY
 * workspace. Whoever signs up on an open server, or owns any one tenant,
 * could swap in their own Meta App and receive the WhatsApp Business
 * tokens of every tenant who connects afterwards. It is the server
 * owner's (isPlatformOwner), like the whole-database backup.
 */

const h = vi.hoisted(() => ({ platformOwner: false, upserts: 0 }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'tenant', role: 'owner' }),
  toErrorResponse: (err: { status?: number; message?: string }) =>
    new Response(JSON.stringify({ error: err.message }), { status: err.status ?? 500 }),
  ForbiddenError: class extends Error {
    readonly status = 403
  },
}))
vi.mock('@/lib/auth/platform-owner', () => ({ isPlatformOwner: () => Promise.resolve(h.platformOwner) }))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => `enc:${s}` }))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaPlatformConfig: {
      findUnique: () => Promise.resolve({ app_id: 'a', config_id: 'c', app_secret: 'enc:s', updated_at: new Date() }),
      upsert: () => {
        h.upserts++
        return Promise.resolve({})
      },
    },
  },
}))

import { GET, PATCH } from './route'

const patch = () =>
  PATCH(
    new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ app_id: 'evil', app_secret: 'evil-secret', config_id: 'evil-cfg' }),
    }) as never,
  )

describe('platform Meta App config', () => {
  beforeEach(() => {
    h.upserts = 0
  })

  it('a tenant owner who is not the server owner can neither read nor replace it', async () => {
    h.platformOwner = false
    expect((await GET()).status).toBe(403)
    expect((await patch()).status).toBe(403)
    expect(h.upserts).toBe(0)
  })

  it('the server owner can', async () => {
    h.platformOwner = true
    expect((await GET()).status).toBe(200)
    expect((await patch()).status).toBe(200)
    expect(h.upserts).toBe(1)
  })
})
