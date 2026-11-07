import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: moving closed leads back to an open status in bulk left their
 * won/lost markers (converted_at, lost_reason, lost_at), so leads being
 * worked again still counted as wins or losses in reports.
 */

const h = vi.hoisted(() => ({ data: [] as Record<string, unknown>[] }))

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
      findMany: () => Promise.resolve([{ id: 'l1', contact_id: null, assigned_to: null }]),
      updateMany: (a: { data: Record<string, unknown> }) => {
        h.data.push(a.data)
        return Promise.resolve({ count: 1 })
      },
    },
    leadActivity: { createMany: () => Promise.resolve({ count: 1 }) },
    conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
  },
}))

import { POST } from './route'

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never)

describe('leads bulk: won and lost markers', () => {
  beforeEach(() => {
    h.data = []
  })

  it('reopening in bulk clears the won and lost markers', async () => {
    expect((await post({ ids: ['l1'], status: 'follow_up' })).status).toBe(200)
    expect(h.data[0]).toMatchObject({ status: 'follow_up', converted_at: null, lost_reason: null, lost_at: null })
  })

  it('closing in bulk leaves them as they are', async () => {
    expect((await post({ ids: ['l1'], status: 'closed' })).status).toBe(200)
    expect(h.data[0]).not.toHaveProperty('converted_at')
  })

  it('closing in bulk records who closed them; reopening clears it', async () => {
    // Closing writes the credit in its own update (only open leads get it,
    // closer-credit.test.ts), so the reopen is the last update, not the second.
    await post({ ids: ['l1'], status: 'closed' })
    await post({ ids: ['l1'], status: 'open' })
    expect(h.data.some((d) => d.closed_by === 'u1')).toBe(true)
    expect(h.data[h.data.length - 1]).toMatchObject({ closed_by: null, lost_reason_key: null })
  })
})
