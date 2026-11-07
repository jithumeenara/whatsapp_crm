import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Marking a stage of the business's own funnel on a lead (Settings →
 * Reports). The stage is recorded as a `stage` activity the report counts;
 * a won or lost stage closes the lead the same way the close dialog does;
 * a key that is not one of this account's stages is refused.
 */

const h = vi.hoisted(() => ({
  existing: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  activities: [] as Record<string, unknown>[],
  stages: [
    { key: 'appointment', label: 'Appointment', outcome: 'open' },
    { key: 'surgery', label: 'Surgery', outcome: 'won' },
    { key: 'not_going', label: 'Not going ahead', outcome: 'lost' },
  ] as unknown,
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
    leadSettings: {
      findUnique: (a: { where: { account_id: string } }) => Promise.resolve(a.where.account_id === 'acc' ? { funnel_stages: h.stages } : null),
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

const base = { id: 'l1', account_id: 'acc', assigned_to: 'me', contact_id: 'c1', notes: null, lead_quality: null, status: 'open', converted_at: null, lost_reason: null, lost_at: null, call_outcome: null }
const stageRows = () => h.activities.filter((a) => a.type === 'stage')

describe('PATCH /api/leads/[id]: funnel stage', () => {
  beforeEach(() => {
    h.updates = []
    h.activities = []
    h.existing = { ...base }
  })

  it('an open stage is recorded and leaves the lead open', async () => {
    expect((await patch({ funnel_stage: 'appointment' })).status).toBe(200)
    expect(stageRows()[0]).toMatchObject({ user_id: 'me', lead_id: 'l1', title: 'Stage: Appointment', metadata: { stage_key: 'appointment', outcome: 'open' } })
    expect(h.updates[0] ?? {}).not.toHaveProperty('status')
  })

  it('a won stage closes the lead as won, credited to whoever marked it', async () => {
    expect((await patch({ funnel_stage: 'surgery' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ status: 'closed', closed_by: 'me', lost_reason: null })
    expect(h.updates[0].converted_at).toBeInstanceOf(Date)
    expect(stageRows()[0]).toMatchObject({ metadata: { stage_key: 'surgery', outcome: 'won' } })
  })

  it('a lost stage closes the lead as lost, with the stage as the reason', async () => {
    expect((await patch({ funnel_stage: 'not_going' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ status: 'closed', lost_reason: 'Not going ahead', lost_reason_key: 'not_going', converted_at: null })
  })

  it('refuses a stage that is not one of this account’s', async () => {
    expect((await patch({ funnel_stage: 'invented' })).status).toBe(400)
    expect(h.updates).toHaveLength(0)
    expect(stageRows()).toHaveLength(0)
  })
})
