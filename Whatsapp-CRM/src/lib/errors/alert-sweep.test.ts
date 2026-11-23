import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An error that keeps happening is told to the right people once: the
 * workspace's admins for its own errors, the server owner for
 * server-wide ones, and never twice for the same claim.
 */

type Row = { id: string; account_id: string | null; where_at: string; message: string; count: number; alerted_at: Date | null }
const h = vi.hoisted(() => ({ rows: [] as Row[], pushes: [] as Array<{ user: string; body: string }> }))

vi.mock('@/lib/push', () => ({ sendPushToUser: async (user: string, p: { body: string }) => { h.pushes.push({ user, body: p.body }) } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    appError: {
      findMany: async () => h.rows.filter((r) => r.alerted_at === null && r.count >= 5),
      updateMany: async ({ where, data }: { where: { id: string; alerted_at: Date | null }; data: { alerted_at: Date } }) => {
        const r = h.rows.find((x) => x.id === where.id && x.alerted_at === where.alerted_at)
        if (!r) return { count: 0 }
        r.alerted_at = data.alerted_at
        return { count: 1 }
      },
    },
    profile: { findMany: async ({ where }: { where: { account_id: string } }) => (where.account_id === 'acc-1' ? [{ user_id: 'admin-1' }] : []) },
    account: { findFirst: async () => ({ owner_user_id: 'server-owner' }) },
    user: { findMany: async () => [] },
  },
}))

import { sweepErrorAlerts } from './alert-sweep'

beforeEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAILS
  h.pushes = []
  h.rows = [
    { id: 'e1', account_id: 'acc-1', where_at: '/inbox', message: 'TypeError: x is undefined', count: 7, alerted_at: null },
    { id: 'e2', account_id: null, where_at: '[graph]', message: 'fetch failed', count: 12, alerted_at: null },
    { id: 'e3', account_id: null, where_at: '[rare]', message: 'once', count: 1, alerted_at: null },
  ]
})

describe('sweepErrorAlerts', () => {
  it("workspace errors go to that workspace's admins; server errors to the server owner", async () => {
    expect(await sweepErrorAlerts()).toBe(2)
    expect(h.pushes.map((p) => p.user).sort()).toEqual(['admin-1', 'server-owner'])
    expect(h.pushes.find((p) => p.user === 'admin-1')?.body).toContain('/inbox')
    expect(h.pushes.find((p) => p.user === 'admin-1')?.body).not.toContain('fetch failed')
  })

  it('a second sweep does not alert the same errors again', async () => {
    await sweepErrorAlerts()
    h.pushes = []
    expect(await sweepErrorAlerts()).toBe(0)
    expect(h.pushes).toHaveLength(0)
  })
})
