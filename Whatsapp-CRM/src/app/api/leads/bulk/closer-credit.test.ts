import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review finding L2: closing leads in bulk set closed_by on every
 * selected lead, including ones already closed or won, so a supervisor's
 * bulk action took the win away from whoever had actually closed it.
 * Only leads that were open get the new closer.
 */

const h = vi.hoisted(() => ({ calls: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> }))

vi.mock('@/lib/audit', () => ({ audit: () => Promise.resolve(), auditCtx: () => ({}) }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'supervisor' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findMany: () => Promise.resolve([{ id: 'l1', contact_id: null, assigned_to: null }, { id: 'l2', contact_id: null, assigned_to: null }]),
      updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        h.calls.push(a)
        return Promise.resolve({ count: 2 })
      },
    },
    leadActivity: { createMany: () => Promise.resolve({ count: 2 }) },
    conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
  },
}))

import { POST } from './route'

describe('leads bulk close: who gets the credit', () => {
  beforeEach(() => {
    h.calls = []
  })

  it('only leads that were still open are credited to the person closing them', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: ['l1', 'l2'], status: 'closed' }) }) as never)
    expect(res.status).toBe(200)
    const credit = h.calls.filter((c) => 'closed_by' in c.data)
    expect(credit).toHaveLength(1)
    expect(credit[0].where).toMatchObject({ account_id: 'acc', status: { not: 'closed' } })
    expect(credit[0].data).toEqual({ closed_by: 'u1' })
  })
})
