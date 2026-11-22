import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The server owner can set up only Instagram / Messenger (no WhatsApp
 * Embedded Signup configuration), each configuration id is digits, and the
 * old shared value is cleared once the separate ones are saved.
 */

const h = vi.hoisted(() => ({ upserts: [] as Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc', role: 'owner' }),
  toErrorResponse: (err: { status?: number; message?: string }) => new Response(JSON.stringify({ error: err.message }), { status: err.status ?? 500 }),
  ForbiddenError: class extends Error { readonly status = 403 },
}))
vi.mock('@/lib/auth/platform-owner', () => ({ isPlatformOwner: () => Promise.resolve(true) }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => `enc:${s}` }))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaPlatformConfig: {
      findUnique: () => Promise.resolve({ app_id: '242', config_id: '', app_secret: 'enc:s', instagram_config_id: null, messenger_config_id: null, social_config_id: '144', updated_at: new Date() }),
      upsert: (a: { create: Record<string, unknown>; update: Record<string, unknown> }) => { h.upserts.push(a); return Promise.resolve({}) },
    },
  },
}))

import { PATCH } from './route'

const patch = (body: unknown) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never)

beforeEach(() => { h.upserts = [] })

describe('per-channel configurations', () => {
  it('only an Instagram configuration (no WhatsApp one): saved, old shared value cleared', async () => {
    const res = await patch({ app_id: '242', app_secret: '••••••••••••••••', config_id: '', instagram_config_id: '1446804114209838', messenger_config_id: '' })
    expect(res.status).toBe(200)
    expect(h.upserts[0].update).toMatchObject({ config_id: '', instagram_config_id: '1446804114209838', messenger_config_id: null, social_config_id: null })
  })

  it('no configuration at all: refused', async () => {
    const res = await patch({ app_id: '242', config_id: '', instagram_config_id: '', messenger_config_id: '' })
    expect(res.status).toBe(400)
    expect(h.upserts).toHaveLength(0)
  })

  it('a configuration id that is not a number: refused', async () => {
    for (const bad of ['abc', '12', '1446804114209838; drop', { x: 1 }]) {
      const res = await patch({ app_id: '242', instagram_config_id: bad })
      expect(res.status).toBe(400)
    }
    expect(h.upserts).toHaveLength(0)
  })

  it('no App ID: refused', async () => {
    expect((await patch({ instagram_config_id: '1446804114209838' })).status).toBe(400)
  })
})
