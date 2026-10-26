import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Deleting a contact used to remove the customer's whole history —
 * conversations, messages, leads, deals and broadcast delivery rows —
 * and any agent could do it. Now a delete archives; removing for good is
 * the owner's call alone.
 */

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  archived: [] as unknown[],
  transactions: 0,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: h.role }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findFirst: () => Promise.resolve({ id: 'k1' }),
      updateMany: (a: unknown) => {
        h.archived.push(a)
        return Promise.resolve({ count: 1 })
      },
    },
    lead: { findMany: () => Promise.resolve([{ id: 'l1' }]) },
    $transaction: () => {
      h.transactions++
      return Promise.resolve()
    },
  },
}))

import { DELETE } from './route'

const del = (qs = '') =>
  DELETE(
    Object.assign(new Request(`http://x/api/contacts/k1${qs}`, { method: 'DELETE' }), {
      nextUrl: new URL(`http://x/api/contacts/k1${qs}`),
    }) as never,
    { params: Promise.resolve({ id: 'k1' }) },
  )

describe('deleting a contact', () => {
  beforeEach(() => {
    h.archived = []
    h.transactions = 0
  })

  it('archives — nothing is removed', async () => {
    h.role = 'agent'
    const res = await del()
    expect(res.status).toBe(200)
    expect(h.archived).toHaveLength(1)
    expect(JSON.stringify(h.archived[0])).toContain('archived_at')
    expect(h.transactions).toBe(0)
  })

  it('an agent, admin or API key cannot remove a contact for good', async () => {
    for (const role of ['agent', 'supervisor', 'admin']) {
      h.role = role
      const res = await del('?permanent=1')
      expect(res.status).toBe(403)
    }
    expect(h.transactions).toBe(0)
  })

  it('the owner can, on purpose', async () => {
    h.role = 'owner'
    const res = await del('?permanent=1')
    expect(res.status).toBe(200)
    expect(h.transactions).toBe(1)
  })
})
