import { beforeEach, describe, expect, it, vi } from 'vitest'
import { diff } from '@/lib/audit/sanitize'

/**
 * Audit log (phase 3): editing a lead records who changed what — only the
 * fields that really changed, with phone numbers masked, never the whole
 * row. Deleting one records that it went.
 */

const h = vi.hoisted(() => ({
  events: [] as Array<{ ctx: unknown; entry: Record<string, unknown> }>,
  lead: {} as Record<string, unknown>,
}))

vi.mock('@/lib/audit', () => ({
  audit: (ctx: unknown, entry: Record<string, unknown>) => {
    h.events.push({ ctx, entry })
    return Promise.resolve()
  },
  auditCtx: (_req: unknown, auth: { accountId: string; userId: string; role: string }) => ({
    accountId: auth.accountId,
    actor: { type: 'user', id: auth.userId, role: auth.role },
    source: 'web',
  }),
}))
vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: 'admin' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/meta-ads/triggers', () => ({ reportMetaAdsOutcome: () => Promise.resolve() }))
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: () => Promise.resolve() }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/leads/owned-refs', () => ({ checkOwnedRefs: () => Promise.resolve(null) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findFirst: () => Promise.resolve({ ...h.lead }),
      update: (a: { data: Record<string, unknown> }) => Promise.resolve({ ...h.lead, ...a.data }),
      delete: () => Promise.resolve({}),
    },
    profile: { findUnique: () => Promise.resolve({ full_name: 'X' }) },
    leadActivity: { create: () => Promise.resolve({}) },
    followUp: { create: () => Promise.resolve({}), updateMany: () => Promise.resolve({ count: 0 }) },
    conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
  },
}))

import { DELETE, PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'l1' }) })

describe('lead audit events', () => {
  beforeEach(() => {
    h.events = []
    h.lead = {
      id: 'l1', account_id: 'acc', assigned_to: 'me', status: 'new', score: 'warm',
      title: 'Enquiry', contact_id: 'c1', notes: null, lead_quality: null, district: 'Kollam',
    }
  })

  it('a PATCH records record.updated with only the changed fields, phone masked', async () => {
    const res = await patch({ title: 'Call back on +91 98470 12345', status: 'new', district: 'Kollam' })
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    const { entry, ctx } = h.events[0]
    expect(entry.action).toBe('record.updated')
    expect(entry.target).toEqual({ type: 'lead', id: 'l1', label: null })
    expect(ctx).toMatchObject({ accountId: 'acc', actor: { type: 'user', id: 'me' } })

    // What the writer stores is the diff of before/after.
    const stored = diff(entry.before as Record<string, unknown>, entry.after as Record<string, unknown>)
    expect(Object.keys(stored ?? {})).toEqual(['title'])
    const [, after] = stored!.title as [string, string]
    expect(after).not.toContain('98470')
    expect(after).toContain('••••2345')
  })

  it('a status move is recorded as record.status_changed', async () => {
    await patch({ status: 'follow_up' })
    expect(h.events.map((e) => e.entry.action)).toEqual(['record.status_changed'])
    const stored = diff(h.events[0].entry.before as Record<string, unknown>, h.events[0].entry.after as Record<string, unknown>)
    expect(stored).toEqual({ status: ['new', 'follow_up'] })
  })

  it('an empty PATCH records nothing', async () => {
    await patch({})
    expect(h.events).toEqual([])
  })

  it('a delete records record.deleted', async () => {
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as never, { params: Promise.resolve({ id: 'l1' }) })
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    expect(h.events[0].entry).toMatchObject({ action: 'record.deleted', target: { type: 'lead', id: 'l1' } })
  })
})
