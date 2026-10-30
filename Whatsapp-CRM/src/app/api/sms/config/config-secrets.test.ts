/**
 * N1 (security review 2026-10): the inbound webhook secrets of the email and
 * SMS channels authenticate inbound customer messages. Only the owner (who is
 * also the only one allowed to save the configuration) may read them; other
 * members still see the connection status.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ role: 'viewer' as string }))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  const ctx = async (min: Parameters<typeof hasMinRole>[1]) => {
    if (!hasMinRole(h.role as Parameters<typeof hasMinRole>[0], min)) throw new actual.ForbiddenError('forbidden')
    return { accountId: 'a1', userId: 'u1', role: h.role, pageAccess: null }
  }
  return { ...actual, requireRole: ctx, getCurrentAccount: () => ctx('viewer') }
})
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => s }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'a1', account_role: h.role }) },
    emailConfig: {
      findUnique: async () => ({ id: 'e1', provider: 'sendgrid', api_key: 'k', from_email: 'a@b.co', inbound_secret: 'EMAIL-SECRET', status: 'active' }),
    },
    smsConfig: {
      findUnique: async () => ({ id: 's1', provider: 'msg91', auth_key: 'k', webhook_secret: 'SMS-SECRET', status: 'active' }),
    },
  },
}))
vi.mock('@/lib/messaging/channels/email', () => ({
  testEmailConnection: async () => ({ ok: true, message: 'ok' }),
  saveEmailConfig: async () => ({ id: 'e1' }),
}))
vi.mock('@/lib/messaging/channels/sms', () => ({
  testSmsConnection: async () => ({ ok: true, message: 'ok' }),
  saveSmsConfig: async () => {},
  registerTextBeeWebhook: async () => ({ ok: true, webhookId: 'w' }),
  deleteTextBeeWebhook: async () => {},
}))

import { GET as emailGET } from '@/app/api/email/config/route'
import { GET as smsGET } from '@/app/api/sms/config/route'

describe('channel config GET — inbound webhook secrets are owner-only', () => {
  for (const role of ['viewer', 'agent', 'supervisor', 'admin']) {
    it(`${role} sees status but no secret`, async () => {
      h.role = role
      const e = await (await emailGET()).json()
      const s = await (await smsGET()).json()
      expect(e.connected).toBe(true)
      expect(s.connected).toBe(true)
      expect(JSON.stringify(e)).not.toContain('EMAIL-SECRET')
      expect(JSON.stringify(s)).not.toContain('SMS-SECRET')
    })
  }
  it('owner sees the secrets (needed to build the webhook URL)', async () => {
    h.role = 'owner'
    const e = await (await emailGET()).json()
    const s = await (await smsGET()).json()
    expect(e.config.inbound_secret).toBe('EMAIL-SECRET')
    expect(s.config.webhook_secret).toBe('SMS-SECRET')
  })
})
