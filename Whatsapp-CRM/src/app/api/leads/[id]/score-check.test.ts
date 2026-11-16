import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PATCH /api/leads/[id] — the score is a short label (Hot, Warm, Cold or
 * the account's own levels). It was written as sent: a number crashed the
 * update into a bare 500, and any length of text was stored and shown as
 * a badge. The bulk route already checked it; this one did not.
 */

const h = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[] }))

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
vi.mock('@/lib/db', () => {
  const lead = () => ({ id: 'l1', account_id: 'acc', assigned_to: 'me', status: 'open', contact_id: null, notes: null, lead_quality: null })
  return {
    prisma: {
      lead: {
        findFirst: () => Promise.resolve(lead()),
        update: (a: { data: Record<string, unknown> }) => {
          h.updates.push(a.data)
          return Promise.resolve({ ...lead(), ...a.data })
        },
        updateMany: () => Promise.resolve({ count: 1 }),
      },
      profile: { findFirst: () => Promise.resolve({ user_id: 'me' }), findUnique: () => Promise.resolve({ full_name: 'X' }) },
      leadActivity: { create: () => Promise.resolve({}) },
      followUp: { create: () => Promise.resolve({}), updateMany: () => Promise.resolve({ count: 0 }) },
      conversation: { updateMany: () => Promise.resolve({ count: 0 }) },
    },
  }
})

import { PATCH } from './route'

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'l1' }) })

describe('PATCH /api/leads/[id]: the score', () => {
  beforeEach(() => {
    h.updates = []
  })

  it('a level is saved trimmed', async () => {
    expect((await patch({ score: '  Hot ' })).status).toBe(200)
    expect(h.updates[0]).toMatchObject({ score: 'Hot' })
  })

  it('text longer than 40 characters is refused and nothing is written', async () => {
    const res = await patch({ score: 'x'.repeat(41) })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('a number or an empty score is refused', async () => {
    expect((await patch({ score: 7 })).status).toBe(400)
    expect((await patch({ score: '   ' })).status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })
})
