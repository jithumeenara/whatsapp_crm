/**
 * Independent security review (A7, 2026-10) — NEW finding.
 *
 * POST /api/email/config, /api/sms/config and /api/rcs/config only check
 * "signed in and has a profile". Their DELETE needs the owner, the SMS
 * test-message route needs admin (A8), but saving the credentials does
 * not: a viewer can replace the account's SendGrid / MSG91 / TextBee /
 * Twilio credentials with their own provider account, after which every
 * outgoing email / SMS / RCS (OTPs, confirmations, broadcasts) flows
 * through — and is logged in — the attacker's provider dashboard. The
 * responses also hand the viewer the inbound webhook secrets
 * (inbound_secret / webhook_secret), so they can forge inbound messages.
 *
 * Secure behaviour (asserted): anyone below owner gets 403 and nothing is
 * saved. Written as it.fails while the hole is open.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ role: 'viewer' as string, saved: 0 }))

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
vi.mock('@/lib/db', () => {
  const cfg = { findUnique: async () => null, update: async () => ({}) }
  return {
    prisma: {
      profile: { findUnique: async () => ({ account_id: 'a1', account_role: h.role }) },
      emailConfig: cfg,
      smsConfig: cfg,
      rcsConfig: cfg,
    },
  }
})
vi.mock('@/lib/messaging/channels/email', () => ({
  testEmailConnection: async () => ({ ok: true, message: 'ok' }),
  saveEmailConfig: async () => {
    h.saved++
    return { id: 'e1' }
  },
}))
vi.mock('@/lib/messaging/channels/sms', () => ({
  testSmsConnection: async () => ({ ok: true, message: 'ok' }),
  saveSmsConfig: async () => {
    h.saved++
  },
  registerTextBeeWebhook: async () => ({ ok: true, webhookId: 'w' }),
  deleteTextBeeWebhook: async () => {},
}))
vi.mock('@/lib/messaging/channels/rcs', () => ({
  testRcsConnection: async () => ({ ok: true, message: 'ok' }),
  saveRcsConfig: async () => {
    h.saved++
  },
}))

import { POST as emailPOST } from '@/app/api/email/config/route'
import { POST as smsPOST } from '@/app/api/sms/config/route'
import { POST as rcsPOST } from '@/app/api/rcs/config/route'

const req = (body: unknown) => new Request('http://x/api/x', { method: 'POST', body: JSON.stringify(body) })
const cases = [
  ['email', () => emailPOST(req({ api_key: 'SG.attacker', from_email: 'x@evil.co' }))],
  ['sms', () => smsPOST(req({ auth_key: 'attacker', sender_id: 'EVIL' }))],
  ['rcs', () => rcsPOST(req({ account_sid: 'ACevil', auth_token: 't', from_number: '+15550000000' }))],
] as const

describe('channel credentials — who may replace them', () => {
  for (const [name, call] of cases) {
    it(`a viewer cannot replace the ${name} provider credentials (expected 403)`, async () => {
      h.role = 'viewer'
      h.saved = 0
      const res = await call()
      expect(res.status).toBe(403)
      expect(h.saved).toBe(0)
    })
    it(`an owner can save the ${name} configuration`, async () => {
      h.role = 'owner'
      h.saved = 0
      const res = await call()
      expect(res.status).toBe(200)
      expect(h.saved).toBe(1)
    })
  }
})
