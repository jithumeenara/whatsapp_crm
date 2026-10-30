import { describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): POST /api/whatsapp/config only checked
 * "signed in". Any member — a viewer included — could connect a new
 * WhatsApp number or replace the access token of the business's number
 * (pointing its sends at a WABA they control). The UI and every sibling
 * route (set-default, direct-send, DELETE) already treat this as the
 * owner's decision (canEditWhatsAppConfig); the POST now does too.
 */

const h = vi.hoisted(() => ({ role: 'viewer' as string, metaChecks: 0 }))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: Parameters<typeof hasMinRole>[1]) => {
      if (!hasMinRole(h.role as Parameters<typeof hasMinRole>[0], min)) throw new actual.ForbiddenError('forbidden')
      return { accountId: 'a1', userId: 'u1', role: h.role }
    },
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'a1', account_role: h.role }) },
    whatsAppConfig: { findFirst: async () => null, findMany: async () => [] },
  },
}))
vi.mock('@/lib/whatsapp/meta-api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/whatsapp/meta-api')>('@/lib/whatsapp/meta-api')),
  verifyPhoneNumber: async () => {
    h.metaChecks++
    throw new Error('stop here')
  },
}))

import { POST } from './route'

const save = () =>
  POST(new Request('http://x/api/whatsapp/config', { method: 'POST', body: JSON.stringify({ phone_number_id: '111', access_token: 'attacker-token' }) }))

describe('WhatsApp connection settings — who may save them', () => {
  for (const role of ['viewer', 'agent', 'supervisor', 'admin']) {
    it(`a ${role} cannot`, async () => {
      h.role = role
      h.metaChecks = 0
      expect((await save()).status).toBe(403)
      expect(h.metaChecks).toBe(0)
    })
  }
  it('the owner can (reaches the Meta check)', async () => {
    h.role = 'owner'
    h.metaChecks = 0
    await save()
    expect(h.metaChecks).toBe(1)
  })
})
