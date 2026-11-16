import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: "Close" in the Leads list bulk bar closed leads without saying
 * whether they were won or lost, so reports counted none of them as
 * either. Closing in bulk now carries the outcome, like the close dialog.
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
const last = () => h.data[h.data.length - 1]

describe('leads bulk: closing as won or lost', () => {
  beforeEach(() => {
    h.data = []
  })

  it('won: the leads are closed with a win date and no loss', async () => {
    expect((await post({ ids: ['l1'], status: 'closed', outcome: 'won' })).status).toBe(200)
    expect(last()).toMatchObject({ status: 'closed', lost_reason: null, lost_at: null, lost_reason_key: null })
    expect(last().converted_at).toBeInstanceOf(Date)
  })

  it('lost: the reason and loss date are saved, and no win', async () => {
    expect((await post({ ids: ['l1'], status: 'closed', outcome: 'lost', lost_reason: '  Went elsewhere  ' })).status).toBe(200)
    expect(last()).toMatchObject({ status: 'closed', converted_at: null, lost_reason: 'Went elsewhere' })
    expect(last().lost_at).toBeInstanceOf(Date)
  })

  it('lost with no reason still records the loss', async () => {
    await post({ ids: ['l1'], status: 'closed', outcome: 'lost' })
    expect(last()).toMatchObject({ converted_at: null, lost_reason: 'Closed in bulk' })
  })

  it('an unknown outcome, or an outcome without closing, is refused', async () => {
    expect((await post({ ids: ['l1'], status: 'closed', outcome: 'maybe' })).status).toBe(400)
    expect((await post({ ids: ['l1'], status: 'follow_up', outcome: 'won' })).status).toBe(400)
    expect(h.data).toHaveLength(0)
  })

  it('a reason longer than 300 characters is cut, not stored whole', async () => {
    await post({ ids: ['l1'], status: 'closed', outcome: 'lost', lost_reason: 'x'.repeat(500) })
    expect(String(last().lost_reason)).toHaveLength(300)
  })
})
