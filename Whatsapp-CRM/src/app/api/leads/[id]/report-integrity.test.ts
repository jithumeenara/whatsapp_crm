import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review findings on PATCH /api/leads/[id] (M3, L1): an agent's
 * report figures must not be inflatable or movable by the agent.
 *  - converted_at was taken from the body as any date, so a win could be
 *    placed in any past or future period. Only a supervisor may give a date;
 *    for anyone else a win is dated now.
 *  - The same call sent twice in a row was counted twice.
 *  - Winning a lead that had been closed as lost (through a won stage or a
 *    conversion) left the credit with whoever lost it.
 */

const h = vi.hoisted(() => ({
  role: 'agent',
  existing: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  activities: [] as Array<Record<string, unknown>>,
  recentCall: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: h.role }),
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
    leadSettings: { findUnique: () => Promise.resolve({ funnel_stages: [{ key: 'surgery', label: 'Surgery', outcome: 'won' }] }) },
    profile: { findFirst: () => Promise.resolve({ user_id: 'me' }), findUnique: () => Promise.resolve({ full_name: 'X' }) },
    leadActivity: {
      findFirst: () => Promise.resolve(h.recentCall),
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

const base = { id: 'l1', account_id: 'acc', assigned_to: 'me', contact_id: 'c1', notes: null, lead_quality: null, status: 'open', converted_at: null, lost_reason: null, lost_at: null, call_outcome: null, closed_by: null }

describe('PATCH /api/leads/[id]: report figures an agent cannot bend', () => {
  beforeEach(() => {
    h.updates = []
    h.activities = []
    h.recentCall = null
    h.role = 'agent'
    h.existing = { ...base }
  })

  it('an agent cannot date a win into another period', async () => {
    const before = Date.now()
    expect((await patch({ status: 'closed', converted_at: '2020-01-01T00:00:00Z' })).status).toBe(200)
    expect((h.updates[0].converted_at as Date).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('a supervisor may record the real date of a win', async () => {
    h.role = 'supervisor'
    expect((await patch({ status: 'closed', converted_at: '2026-10-01T10:00:00Z' })).status).toBe(200)
    expect((h.updates[0].converted_at as Date).toISOString()).toBe('2026-10-01T10:00:00.000Z')
  })

  it('the same call sent again within moments is not counted twice', async () => {
    h.recentCall = { id: 'a1' }
    expect((await patch({ status: 'call_not_connected', call_outcome: 'Busy', call_result: 'not_connected' })).status).toBe(200)
    expect(h.activities.filter((a) => a.type === 'call')).toHaveLength(0)
  })

  it('winning a lead that was closed as lost credits whoever won it', async () => {
    h.existing = { ...base, status: 'closed', lost_reason: 'Price', lost_at: new Date('2026-10-01'), closed_by: 'colleague' }
    h.role = 'supervisor'
    expect((await patch({ funnel_stage: 'surgery' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ closed_by: 'me', lost_reason: null })
  })
})
