import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Round 2: an invitation may be made for one address. It is stored
 * trimmed and lowercased, so "Anu@Example.com " and the address she signs
 * up with compare equal; anything that is not an address is refused.
 * Leaving it out makes a link as before. Owner seats are never offered.
 */

const h = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, role: 'admin' }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc', role: h.role }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    accountInvitation: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        h.data = data
        return Promise.resolve({ id: 'i', role: data.role, label: null, email: data.email, expires_at: new Date(), created_at: new Date() })
      },
    },
  },
}))

import { POST } from './route'

const post = (body: unknown) => POST(new Request('https://crm.example/api/account/invitations', { method: 'POST', body: JSON.stringify(body) }))

describe('creating an invitation', () => {
  beforeEach(() => {
    h.data = null
  })

  it('stores the address trimmed and lowercased', async () => {
    expect((await post({ role: 'agent', email: '  Anu@Example.COM ' })).status).toBe(201)
    expect(h.data).toEqual(expect.objectContaining({ email: 'anu@example.com', account_id: 'acc', role: 'agent' }))
  })

  it('refuses something that is not an address', async () => {
    expect((await post({ role: 'agent', email: 'not an email' })).status).toBe(400)
    expect(h.data).toBeNull()
  })

  it('makes an open link when no address is given', async () => {
    expect((await post({ role: 'viewer' })).status).toBe(201)
    expect(h.data).toEqual(expect.objectContaining({ email: null }))
  })

  it('never offers the owner seat', async () => {
    expect((await post({ role: 'owner', email: 'a@b.co' })).status).toBe(400)
  })
})
