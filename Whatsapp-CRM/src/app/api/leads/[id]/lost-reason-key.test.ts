import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review finding L3: lost_reason_key was accepted as any short
 * string, so made-up labels could appear in the owner's Lost reasons
 * report. Only a reason from the business's close-reason list (or its
 * defaults), or one of its own lost funnel stages, is accepted.
 */

const h = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: 'agent' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/audit', () => ({ audit: () => Promise.resolve(), auditCtx: () => ({}) }))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/meta-ads/triggers', () => ({ reportMetaAdsOutcome: () => Promise.resolve() }))
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: () => Promise.resolve() }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findFirst: () => Promise.resolve({ id: 'l1', account_id: 'acc', assigned_to: 'me', contact_id: null, notes: null, lead_quality: null, status: 'open', converted_at: null }),
      update: (a: { data: Record<string, unknown> }) => {
        h.updates.push(a.data)
        return Promise.resolve({ id: 'l1', ...a.data })
      },
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    leadSettings: { findUnique: () => Promise.resolve(h.settings) },
    profile: { findFirst: () => Promise.resolve({ user_id: 'me' }), findUnique: () => Promise.resolve({ full_name: 'X' }) },
    leadActivity: { create: () => Promise.resolve({}) },
    followUp: { create: () => Promise.resolve({}), updateMany: () => Promise.resolve({ count: 0 }) },
    conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
  },
}))

import { PATCH } from './route'

const close = (key: string) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'closed', lost_reason: 'Some words', lost_reason_key: key }) }) as never, { params: Promise.resolve({ id: 'l1' }) })

describe('PATCH /api/leads/[id]: lost reason key', () => {
  beforeEach(() => {
    h.updates = []
    h.settings = null
  })

  it('accepts a default reason when the business has not set its own list', async () => {
    expect((await close('Budget Issue')).status).toBe(200)
  })

  it('accepts a reason from the business’s own list, or one of its lost stages', async () => {
    h.settings = { close_enquiry_reasons: [{ icon: '', label: 'Chose another hospital' }], funnel_stages: [{ key: 'not_going', label: 'Not going ahead', outcome: 'lost' }] }
    expect((await close('Chose another hospital')).status).toBe(200)
    expect((await close('not_going')).status).toBe(200)
  })

  it('refuses a made-up reason, writing nothing', async () => {
    h.settings = { close_enquiry_reasons: [{ icon: '', label: 'Chose another hospital' }], funnel_stages: [] }
    expect((await close('Agent was brilliant')).status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })
})
