import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reports count calls and credit wins, so the lead PATCH must record:
 *  - every call outcome as its own `call` activity, including a second
 *    "not connected" in a row, which changes no status and used to
 *    leave no trace at all;
 *  - who closed the lead (a win belongs to them, not to whoever holds
 *    the lead later), cleared again on reopen;
 *  - the picked lost reason's key beside the words.
 */

const h = vi.hoisted(() => ({
  existing: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  activities: [] as Record<string, unknown>[],
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
      findFirst: () => Promise.resolve({ ...h.existing }),
      update: (a: { data: Record<string, unknown> }) => {
        h.updates.push(a.data)
        return Promise.resolve({ ...h.existing, ...a.data })
      },
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    profile: { findFirst: () => Promise.resolve({ user_id: 'me' }), findUnique: () => Promise.resolve({ full_name: 'X' }) },
    leadActivity: {
      create: (a: { data: Record<string, unknown> }) => {
        h.activities.push(a.data)
        return Promise.resolve(a.data)
      },
    },
    followUp: { create: () => Promise.resolve({}), updateMany: () => Promise.resolve({ count: 0 }) },
    conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
  },
}))

import { PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'l1' }) })

const base = { id: 'l1', account_id: 'acc', assigned_to: 'me', contact_id: 'c1', notes: null, lead_quality: null, converted_at: null, lost_reason: null, lost_at: null }
const calls = () => h.activities.filter((a) => a.type === 'call')

describe('PATCH /api/leads/[id]: calls and closing', () => {
  beforeEach(() => {
    h.updates = []
    h.activities = []
  })

  it('a repeat "not connected" call is still recorded as a call', async () => {
    h.existing = { ...base, status: 'call_not_connected', call_outcome: 'Busy' }
    expect((await patch({ status: 'call_not_connected', call_outcome: 'Switched off', call_result: 'not_connected' })).status).toBe(200)
    expect(calls()).toHaveLength(1)
    expect(calls()[0]).toMatchObject({ user_id: 'me', lead_id: 'l1', metadata: { connected: false, outcome: 'Switched off' } })
  })

  it('a connected call is recorded and clears the last not-connected reason', async () => {
    h.existing = { ...base, status: 'call_not_connected', call_outcome: 'Busy' }
    expect((await patch({ status: 'visited', call_result: 'connected' })).status).toBe(200)
    expect(calls()[0]).toMatchObject({ metadata: { connected: true, outcome: 'visited' } })
    expect(h.updates[0]).toMatchObject({ call_outcome: null })
  })

  it('an ordinary edit records no call', async () => {
    h.existing = { ...base, status: 'open', call_outcome: null }
    expect((await patch({ notes: 'Wants a morning slot' })).status).toBe(200)
    expect(calls()).toHaveLength(0)
  })

  it('refuses an unknown call result', async () => {
    h.existing = { ...base, status: 'open', call_outcome: null }
    expect((await patch({ status: 'open', call_result: 'maybe' })).status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('closing records who closed it and the reason key; reopening clears who', async () => {
    h.existing = { ...base, status: 'open', call_outcome: null }
    expect((await patch({ status: 'closed', lost_reason: 'Chose another hospital', lost_reason_key: 'competitor' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ closed_by: 'me', lost_reason_key: 'competitor' })

    h.updates = []
    h.existing = { ...base, status: 'closed', closed_by: 'me', lost_reason: 'x', lost_reason_key: 'competitor' }
    expect((await patch({ status: 'follow_up' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ closed_by: null, lost_reason_key: null })
  })
})
