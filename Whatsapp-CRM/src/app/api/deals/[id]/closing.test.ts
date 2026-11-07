import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reports count a deal's money on the day it was won or lost, so moving a
 * deal on the board must stamp won_at / lost_at / closed_by and leave a
 * history row, and reopening must clear them.
 */

const h = vi.hoisted(() => ({
  existing: {} as Record<string, unknown>,
  stage: { stage_type: 'won' } as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'agent' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/audit', () => ({ audit: () => Promise.resolve(), auditCtx: () => ({}) }))
vi.mock('@/lib/meta-ads/triggers', () => ({ reportMetaAdsOutcome: () => Promise.resolve() }))
vi.mock('@/lib/leads/owned-refs', () => ({ checkOwnedRefs: () => Promise.resolve(null) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    deal: {
      findFirst: () => Promise.resolve({ ...h.existing }),
      update: (a: { data: Record<string, unknown> }) => {
        h.updates.push(a.data)
        // Like Prisma: a field given as undefined is left as it was.
        const set = Object.fromEntries(Object.entries(a.data).filter(([, v]) => v !== undefined))
        return Promise.resolve({ ...h.existing, ...set })
      },
    },
    pipelineStage: { findFirst: () => Promise.resolve(h.stage) },
    dealStageEvent: {
      create: (a: { data: Record<string, unknown> }) => {
        h.events.push(a.data)
        return Promise.resolve(a.data)
      },
    },
  },
}))

import { PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'd1' }) })

const OPEN = { id: 'd1', account_id: 'acc', pipeline_id: 'p1', stage_id: 's-open', status: 'open', value: 50000, won_at: null, lost_at: null }

describe('PATCH /api/deals/[id]: closing a deal', () => {
  beforeEach(() => {
    h.updates = []
    h.events = []
    h.stage = { stage_type: 'won' }
  })

  it('dragging into the Won stage stamps when and by whom, and records the move', async () => {
    h.existing = { ...OPEN }
    expect((await patch({ stage_id: 's-won' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ status: 'won', closed_by: 'u1', lost_at: null })
    expect(h.updates[0].won_at).toBeInstanceOf(Date)
    expect(h.events[0]).toMatchObject({ deal_id: 'd1', from_stage_id: 's-open', to_stage_id: 's-won', from_status: 'open', to_status: 'won', value: '50000', user_id: 'u1' })
  })

  it('a loss keeps the reason given with it', async () => {
    h.existing = { ...OPEN }
    h.stage = { stage_type: 'lost' }
    expect((await patch({ stage_id: 's-lost', lost_reason: ' Chose another hospital ' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ status: 'lost', lost_reason: 'Chose another hospital', won_at: null })
  })

  it('moving a won deal back to an open stage clears the closing fields', async () => {
    h.existing = { ...OPEN, stage_id: 's-won', status: 'won', won_at: new Date('2026-11-01') }
    h.stage = { stage_type: 'open' }
    expect((await patch({ stage_id: 's-open' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ status: 'open', won_at: null, lost_at: null, closed_by: null })
  })

  it('a title edit leaves the closing fields and the history alone', async () => {
    h.existing = { ...OPEN, status: 'won', won_at: new Date('2026-11-01') }
    expect((await patch({ title: 'Knee replacement' })).status).toBe(200)
    expect(h.updates[0]).not.toHaveProperty('won_at')
    expect(h.events).toHaveLength(0)
  })

  it('refuses a status that is not open, won or lost', async () => {
    h.existing = { ...OPEN }
    expect((await patch({ status: 'closed' })).status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })
})
