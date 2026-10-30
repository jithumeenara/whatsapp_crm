import { describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): "Send a test SMS" only checked "signed
 * in": a viewer could send paid SMS, with any text the route chose, to any
 * number on the business's MSG91/TextBee balance. It belongs to the SMS
 * settings screen, so it now needs admin.
 */

const h = vi.hoisted(() => ({ role: 'viewer' as string, sent: 0 }))
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
    profile: { findUnique: async () => ({ account_id: 'a1' }) },
    smsConfig: { findUnique: async () => ({ id: 's1' }) },
  },
}))
vi.mock('@/lib/messaging/channels/sms', () => ({
  sendSmsText: async () => {
    h.sent++
    return { messageId: 'm' }
  },
}))

import { POST } from './route'

const send = () => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ to: '+919847012345' }) }))

describe('test SMS — who may send it', () => {
  for (const role of ['viewer', 'agent', 'supervisor']) {
    it(`a ${role} cannot`, async () => {
      h.role = role
      h.sent = 0
      expect((await send()).status).toBe(403)
      expect(h.sent).toBe(0)
    })
  }
  it('an admin can', async () => {
    h.role = 'admin'
    h.sent = 0
    expect((await send()).status).toBe(200)
    expect(h.sent).toBe(1)
  })
})
