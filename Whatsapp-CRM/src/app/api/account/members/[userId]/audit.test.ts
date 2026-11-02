import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A role change is recorded inside the same transaction as the change
 * itself (plan §6): if the audit write fails, the role does not change.
 */

const h = vi.hoisted(() => ({
  calls: [] as string[],
  inTx: [] as Array<{ tx: unknown; entries: unknown }>,
  failAudit: false,
  tx: { profile: { update: () => Promise.resolve({}) } } as Record<string, unknown>,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'actor', accountId: '11111111-1111-4111-8111-111111111111', role: 'owner' }),
  toErrorResponse: (e: unknown) => new Response(JSON.stringify({ error: String(e) }), { status: 500 }),
  forgetCachedProfile: () => h.calls.push('forget'),
}))
vi.mock('@/lib/auth/deactivate-member', () => ({ deactivateMember: () => Promise.resolve() }))
vi.mock('@/lib/audit', async () => {
  const real = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit')
  return {
    ...real,
    audit: () => Promise.resolve(),
    auditInTx: (tx: unknown, _ctx: unknown, entries: unknown) => {
      h.calls.push('auditInTx')
      h.inTx.push({ tx, entries })
      return h.failAudit ? Promise.reject(new Error('audit down')) : Promise.resolve()
    },
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findFirst: () =>
        Promise.resolve({ account_role: 'agent', restrict_to_assigned: false, page_access: null, handles_categories: [], full_name: 'Anu' }),
      update: () => {
        h.calls.push('update-outside-tx')
        return Promise.resolve({})
      },
    },
    serviceCategory: { findMany: () => Promise.resolve([]) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.tx.profile = {
        update: () => {
          h.calls.push('update-in-tx')
          return Promise.resolve({})
        },
      }
      return fn(h.tx)
    },
  },
}))

import { PATCH } from './route'

const patch = (body: unknown) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ userId: 'target' }) })

describe('member role change is audited in the transaction', () => {
  beforeEach(() => {
    h.calls = []
    h.inTx = []
    h.failAudit = false
  })

  it('writes member.role_changed with the old and new role, inside the same transaction', async () => {
    const res = await patch({ role: 'supervisor' })
    expect(res.status).toBe(200)
    expect(h.calls).toEqual(['update-in-tx', 'auditInTx', 'forget'])
    expect(h.inTx[0].tx).toBe(h.tx)
    const [entry] = h.inTx[0].entries as Array<{ action: string; target: { id: string }; before: unknown; after: unknown }>
    expect(entry.action).toBe('member.role_changed')
    expect(entry.target.id).toBe('target')
    expect(entry.before).toEqual({ role: 'agent' })
    expect(entry.after).toEqual({ role: 'supervisor' })
  })

  it('fails the change when the audit write fails (fail closed)', async () => {
    h.failAudit = true
    const res = await patch({ role: 'supervisor' })
    expect(res.status).toBe(500)
    expect(h.calls).not.toContain('forget')
    expect(h.calls).not.toContain('update-outside-tx')
  })

  it('records a page-access change the same way', async () => {
    await patch({ page_access: ['/inbox'] })
    const [entry] = h.inTx[0].entries as Array<{ action: string }>
    expect(entry.action).toBe('member.pages_changed')
  })

  it('working hours alone need no transaction', async () => {
    await patch({ working_hours: null })
    expect(h.calls).toContain('update-outside-tx')
    expect(h.calls).not.toContain('auditInTx')
  })
})
