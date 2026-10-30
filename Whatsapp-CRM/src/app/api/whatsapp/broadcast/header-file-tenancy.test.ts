import { describe, expect, it, vi } from 'vitest'

/**
 * POST /api/whatsapp/broadcast takes each recipient's `messageParams` from
 * the body, including `headerMediaUrl`. sendTemplateMessage uploads a
 * local `/api/files/...` header to Meta and checks it belongs to the
 * sending account — but only when it is told the account. This route did
 * not pass it, so a member of account A could broadcast account B's
 * stored file as a template header (A3-22 / A8-04).
 */

const h = vi.hoisted(() => ({ args: [] as Array<Record<string, unknown>> }))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'me' } }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => null, RATE_LIMITS: { broadcast: {} } }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({
  NoWhatsAppConfigError: class extends Error {},
  resolveWhatsAppConfig: async () => ({ phone_number_id: 'pn', access_token: 'x' }),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'wa-token' }))
vi.mock('@/lib/whatsapp/template-row-guard', () => ({ isMessageTemplate: () => true }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: vi.fn(async (a: Record<string, unknown>) => { h.args.push(a); return { messageId: 'wamid.1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'acc-a', account_role: 'owner' }) },
    messageTemplate: { findFirst: async () => ({ name: 't', language: 'en_US', header_type: 'image', body_text: 'Hi' }) },
  },
}))

import { POST } from './route'

describe('POST /api/whatsapp/broadcast — template header file', () => {
  it('tells sendTemplateMessage the sending account, so another account’s file is refused', async () => {
    const res = await POST(new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({
        template_name: 't',
        recipients: [{ phone: '+14155550100', messageParams: { headerMediaUrl: '/api/files/account-acc-b/secret.jpg' } }],
      }),
    }))
    expect(res.status).toBeLessThan(500)
    expect(h.args).toHaveLength(1)
    expect(h.args[0].accountId).toBe('acc-a')
  })
})
