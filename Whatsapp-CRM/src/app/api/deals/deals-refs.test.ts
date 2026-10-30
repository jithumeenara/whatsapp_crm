import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Deals, tasks and lead activities wrote the ids in the body as given.
 * A contact id from another workspace attached that workspace's customer
 * to this deal — and the response's `contact { name, phone }` read them
 * back. A deal could also be moved into another pipeline's stage.
 */

const h = vi.hoisted(() => ({ writes: [] as Record<string, unknown>[] }))

vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'agent' }),
  requireRole: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'agent' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/meta-ads/triggers', () => ({ reportMetaAdsOutcome: () => Promise.resolve() }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
const mine = (id: string) => id.endsWith('-mine')
vi.mock('@/lib/db', () => ({
  prisma: {
    pipeline: { findFirst: () => Promise.resolve({ id: 'p1', account: { default_currency: 'INR' } }) },
    pipelineStage: {
      findFirst: (a: { where: { id: string; pipeline_id: string } }) =>
        Promise.resolve(a.where.id === 'st-mine' && a.where.pipeline_id === 'p1' ? { id: 'st-mine', stage_type: 'open' } : null),
    },
    deal: {
      findFirst: () => Promise.resolve({ id: 'd1', account_id: 'acc', pipeline_id: 'p1', stage_id: 'st-mine', status: 'open' }),
      create: (a: { data: Record<string, unknown> }) => { h.writes.push(a.data); return Promise.resolve({ id: 'd2', ...a.data }) },
      update: (a: { data: Record<string, unknown> }) => { h.writes.push(a.data); return Promise.resolve({ id: 'd1', ...a.data }) },
    },
    task: {
      findFirst: () => Promise.resolve({ id: 't1', account_id: 'acc' }),
      create: (a: { data: Record<string, unknown> }) => { h.writes.push(a.data); return Promise.resolve({ id: 't2', ...a.data }) },
    },
    leadActivity: { create: (a: { data: Record<string, unknown> }) => { h.writes.push(a.data); return Promise.resolve({ id: 'a1' }) } },
    contact: { findFirst: (a: { where: { id: string } }) => Promise.resolve(mine(a.where.id) ? { id: a.where.id } : null) },
    lead: { findFirst: (a: { where: { id: string } }) => Promise.resolve(mine(a.where.id) ? { id: a.where.id } : null) },
    conversation: { findFirst: (a: { where: { id: string } }) => Promise.resolve(mine(a.where.id) ? { id: a.where.id } : null) },
    profile: { findFirst: (a: { where: { user_id: string } }) => Promise.resolve(mine(a.where.user_id) ? { user_id: a.where.user_id } : null) },
  },
}))

import { POST as createDeal } from './route'
import { PATCH as patchDeal } from './[id]/route'
import { POST as createTask } from '../tasks/route'
import { POST as logActivity } from '../lead-activities/route'

const json = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never

describe('related ids must be this account’s', () => {
  beforeEach(() => {
    h.writes = []
  })

  it('a deal cannot point at another workspace’s contact, lead, chat or person', async () => {
    const base = { title: 'D', pipeline_id: 'p1', stage_id: 'st-mine' }
    for (const extra of [{ contact_id: 'c-theirs' }, { lead_id: 'l-theirs' }, { conversation_id: 'cv-theirs' }, { assigned_to: 'u-theirs' }]) {
      expect((await createDeal(json({ ...base, ...extra }))).status).toBe(400)
    }
    expect(h.writes).toEqual([])
    expect((await createDeal(json({ ...base, contact_id: 'c-mine' }))).status).toBe(201)
  })

  it('a deal cannot be moved into a stage outside its pipeline, or to another workspace’s contact', async () => {
    const params = { params: Promise.resolve({ id: 'd1' }) }
    expect((await patchDeal(json({ stage_id: 'st-theirs', status: 'open' }), params)).status).toBe(400)
    expect((await patchDeal(json({ contact_id: 'c-theirs' }), params)).status).toBe(400)
    expect(h.writes).toEqual([])
  })

  it('a task cannot point at another workspace’s contact', async () => {
    expect((await createTask(json({ title: 'T', contact_id: 'c-theirs' }))).status).toBe(400)
    expect(h.writes).toEqual([])
  })

  it('a lead activity cannot be filed under another workspace’s lead', async () => {
    expect((await logActivity(json({ type: 'note', title: 'x', lead_id: 'l-theirs' }))).status).toBe(400)
    expect(h.writes).toEqual([])
  })
})
