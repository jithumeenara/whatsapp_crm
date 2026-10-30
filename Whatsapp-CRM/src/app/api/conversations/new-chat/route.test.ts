import { describe, expect, it, vi } from 'vitest'

/**
 * Starting a chat creates a contact and a conversation — a write. The
 * route asked only that somebody be signed in, so a viewer could do it.
 */

const h = vi.hoisted(() => ({ role: 'viewer' as string, created: 0 }))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: 'viewer' | 'agent' | 'supervisor' | 'admin' | 'owner') => {
      if (!hasMinRole(h.role as never, min)) throw new actual.ForbiddenError(`This action requires the '${min}' role or higher`)
      return { accountId: 'acc', userId: 'u1', role: h.role }
    },
  }
})
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({
  resolveWhatsAppConfig: () => { h.created++; return Promise.resolve({ id: 'w1' }) },
  NoWhatsAppConfigError: class extends Error {},
}))
vi.mock('@/lib/contacts/dedupe', () => ({ findExistingContact: () => Promise.resolve(null), isUniqueViolation: () => false }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: () => Promise.resolve({ account_id: 'acc' }) },
    contact: { create: () => { h.created++; return Promise.resolve({ id: 'c1' }) } },
    conversation: { findUnique: () => Promise.resolve({ id: 'cv1' }), findFirst: () => Promise.resolve(null), create: () => { h.created++; return Promise.resolve({ id: 'cv1' }) } },
  },
}))

import { POST } from './route'

describe('POST /api/conversations/new-chat', () => {
  it('a viewer cannot start a chat', async () => {
    h.role = 'viewer'
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ phone: '+919812345678' }) }))
    expect(res.status).toBe(403)
    expect(h.created).toBe(0)
  })
})
