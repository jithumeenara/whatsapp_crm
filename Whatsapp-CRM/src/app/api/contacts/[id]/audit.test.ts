import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Audit log (phase 3): archiving a contact and removing one for good are
 * both recorded, and the permanent removal is marked as permanent.
 */

const h = vi.hoisted(() => ({
  role: 'owner' as string,
  events: [] as Array<Record<string, unknown>>,
  archivedCount: 1,
}))

vi.mock('@/lib/audit', () => ({
  audit: (_ctx: unknown, entry: Record<string, unknown>) => {
    h.events.push(entry)
    return Promise.resolve()
  },
  auditCtx: (_req: unknown, auth: { accountId: string; userId: string }) => ({
    accountId: auth.accountId,
    actor: { type: 'user', id: auth.userId },
    source: 'web',
  }),
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
      updateMany: () => Promise.resolve({ count: h.archivedCount }),
    },
    lead: { findMany: () => Promise.resolve([]) },
    $transaction: () => Promise.resolve(),
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

describe('contact delete audit events', () => {
  beforeEach(() => {
    h.events = []
    h.archivedCount = 1
  })

  it('a permanent delete records record.deleted with meta.permanent = true', async () => {
    h.role = 'owner'
    const res = await del('?permanent=1')
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({
      action: 'record.deleted',
      target: { type: 'contact', id: 'k1' },
      meta: { permanent: true },
    })
  })

  it('a refused permanent delete records nothing here', async () => {
    h.role = 'admin'
    expect((await del('?permanent=1')).status).toBe(403)
    expect(h.events).toEqual([])
  })

  it('an archive records record.archived, once', async () => {
    h.role = 'agent'
    await del()
    expect(h.events.map((e) => e.action)).toEqual(['record.archived'])
    h.events = []
    h.archivedCount = 0 // already archived: nothing changed
    await del()
    expect(h.events).toEqual([])
  })
})
