import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: a lead's won/lost markers outlived the decision they recorded.
 *
 *  - Reopening a closed lead (any status other than "closed") left
 *    converted_at, lost_reason and lost_at in place. The detail page
 *    never sends those fields on a reopen, so a lead being worked again
 *    still counted as a win or a loss in every report window.
 *  - Marking a lead lost left an earlier converted_at, so the same lead
 *    counted as won and lost at once.
 */

const h = vi.hoisted(() => ({
  existing: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: 'supervisor' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/meta-ads/triggers', () => ({ reportMetaAdsOutcome: () => Promise.resolve() }))
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: () => Promise.resolve() }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      findFirst: () => Promise.resolve({ ...h.existing }),
      update: (a: { data: Record<string, unknown> }) => {
        h.updates.push(a.data)
        return Promise.resolve({ ...h.existing, ...a.data })
      },
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    profile: { findFirst: () => Promise.resolve({ user_id: 'me' }), findUnique: () => Promise.resolve({ full_name: 'X' }) },
    leadActivity: { create: () => Promise.resolve({}) },
    followUp: { create: () => Promise.resolve({}), updateMany: () => Promise.resolve({ count: 0 }) },
    conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
  },
}))

import { PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'l1' }) })

const base = { id: 'l1', account_id: 'acc', assigned_to: 'me', contact_id: null, notes: null, lead_quality: null }

describe('PATCH /api/leads/[id]: won and lost markers', () => {
  beforeEach(() => {
    h.updates = []
  })

  it('reopening a won lead clears its conversion', async () => {
    h.existing = { ...base, status: 'closed', converted_at: new Date('2026-11-01'), lost_reason: null, lost_at: null }
    expect((await patch({ status: 'follow_up' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ status: 'follow_up', converted_at: null })
  })

  it('reopening a lost lead clears its reason and date', async () => {
    h.existing = { ...base, status: 'closed', converted_at: null, lost_reason: 'Too far', lost_at: new Date('2026-11-01') }
    expect((await patch({ status: 'open' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ status: 'open', lost_reason: null, lost_at: null })
  })

  it('marking a lead lost clears an earlier conversion', async () => {
    h.existing = { ...base, status: 'open', converted_at: new Date('2026-11-01'), lost_reason: null, lost_at: null }
    expect((await patch({ status: 'closed', lost_reason: 'Price' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ lost_reason: 'Price', converted_at: null })
  })

  it('an edit that does not reopen keeps the markers', async () => {
    h.existing = { ...base, status: 'closed', converted_at: new Date('2026-11-01'), lost_reason: null, lost_at: null }
    expect((await patch({ closing_remarks: 'Paid in full' })).status).toBe(200)
    expect(h.updates[0]).not.toHaveProperty('converted_at')
  })
})
