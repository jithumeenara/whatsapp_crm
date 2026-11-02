import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Audit log (phase 3): a bulk change is ONE parent event with the count
 * and the ids, tied together by a correlation id â€” not one event per row.
 */

const h = vi.hoisted(() => ({
  events: [] as Array<{ ctx: Record<string, unknown>; entry: Record<string, unknown> }>,
}))

vi.mock('@/lib/audit', () => ({
  audit: (ctx: Record<string, unknown>, entry: Record<string, unknown>) => {
    h.events.push({ ctx, entry })
    return Promise.resolve()
  },
  auditCtx: (_req: unknown, auth: { accountId: string; userId: string }) => ({
    accountId: auth.accountId,
    actor: { type: 'user', id: auth.userId },
    source: 'web',
  }),
}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'supervisor' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
const ROWS = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, contact_id: null, assigned_to: null }))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findMany: () => Promise.resolve(ROWS),
      updateMany: () => Promise.resolve({ count: ROWS.length }),
    },
    leadActivity: { createMany: () => Promise.resolve({ count: ROWS.length }) },
    conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
  },
}))

import { POST } from './route'

describe('leads bulk audit', () => {
  beforeEach(() => {
    h.events = []
  })

  it('records one record.bulk_updated with the count and ids', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: ROWS.map((r) => r.id), status: 'visited' }) }) as never,
    )
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    const { entry, ctx } = h.events[0]
    expect(entry.action).toBe('record.bulk_updated')
    expect(entry.target).toMatchObject({ type: 'lead' })
    const meta = entry.meta as { count: number; ids: string[]; op: string }
    expect(meta.count).toBe(30)
    expect(meta.ids).toHaveLength(30)
    expect(meta.op).toBe('status')
    expect(typeof ctx.correlationId).toBe('string')
  })
})
