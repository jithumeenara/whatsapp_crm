import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Bug (security audit 2026-10): PATCH /api/whatsapp/profile only checked
 * "signed in", so a viewer (or any agent) could rewrite the business's
 * public WhatsApp profile — about, description, address, email, websites —
 * which every customer sees. Changing it now needs admin.
 */

const h = vi.hoisted(() => ({ role: 'viewer' as string, updates: 0 }))

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
vi.mock('@/lib/db', () => ({ prisma: { profile: { findUnique: async () => ({ account_id: 'a1' }) } } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({
  resolveWhatsAppConfig: async () => ({ phone_number_id: 'pn', access_token: 't' }),
  NoWhatsAppConfigError: class extends Error {},
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getWhatsAppBusinessProfile: async () => ({}),
  verifyPhoneNumber: async () => ({}),
  updateWhatsAppBusinessProfile: async () => {
    h.updates++
  },
  WHATSAPP_BUSINESS_VERTICALS: [],
}))

import { PATCH } from './route'

const patch = () =>
  new NextRequest('http://x/api/whatsapp/profile', { method: 'PATCH', body: JSON.stringify({ about: 'Scam — pay here' }) })

describe('WhatsApp business profile — who may change it', () => {
  for (const role of ['viewer', 'agent', 'supervisor']) {
    it(`a ${role} cannot`, async () => {
      h.role = role
      h.updates = 0
      expect((await PATCH(patch())).status).toBe(403)
      expect(h.updates).toBe(0)
    })
  }
  it('an admin can', async () => {
    h.role = 'admin'
    h.updates = 0
    expect((await PATCH(patch())).status).toBe(200)
    expect(h.updates).toBe(1)
  })
})
