import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Instagram / Page webhook verify token lives in the database (the user
 * wants no integration settings in .env). Only the server owner can make
 * one; it is stored sealed and returned once, never read back.
 */

const h = vi.hoisted(() => ({ platformOwner: true, exists: true, updates: [] as Array<Record<string, unknown>>, audits: 0 }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc', role: 'owner' }),
  toErrorResponse: (err: { status?: number; message?: string }) => new Response(JSON.stringify({ error: err.message }), { status: err.status ?? 500 }),
  ForbiddenError: class extends Error { readonly status = 403 },
}))
vi.mock('@/lib/auth/platform-owner', () => ({ isPlatformOwner: () => Promise.resolve(h.platformOwner) }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async (_c: unknown, _a: string, d: { fields: string[] }) => { h.audits++; expect(JSON.stringify(d)).not.toMatch(/[0-9a-f]{64}/) } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ sealSecret: (v: string) => `sealed:${v}` }))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaPlatformConfig: {
      findUnique: () => Promise.resolve(h.exists ? { id: 'singleton' } : null),
      update: (a: { data: Record<string, unknown> }) => { h.updates.push(a.data); return Promise.resolve({}) },
    },
  },
}))

import { POST } from './route'

const post = () => POST(new Request('http://x', { method: 'POST' }) as never)

beforeEach(() => { h.platformOwner = true; h.exists = true; h.updates = []; h.audits = 0 })

describe('webhook verify token in the database', () => {
  it('the server owner gets a new random token once; it is saved sealed', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { verify_token } = (await res.json()) as { verify_token: string }
    expect(verify_token).toMatch(/^[0-9a-f]{64}$/)
    expect(h.updates[0].webhook_verify_token).toBe(`sealed:${verify_token}`)
    expect(h.audits).toBe(1)
  })

  it('two tokens are never the same', async () => {
    const a = ((await (await post()).json()) as { verify_token: string }).verify_token
    const b = ((await (await post()).json()) as { verify_token: string }).verify_token
    expect(a).not.toBe(b)
  })

  it('a workspace owner who is not the server owner cannot make one', async () => {
    h.platformOwner = false
    expect((await post()).status).toBe(403)
    expect(h.updates).toHaveLength(0)
  })

  it('no Meta App saved yet: a plain message, nothing written', async () => {
    h.exists = false
    expect((await post()).status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })
})
