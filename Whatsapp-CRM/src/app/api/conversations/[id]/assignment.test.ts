import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who a conversation belongs to.
 *
 *  - POST /assign let any agent move any conversation to anybody —
 *    including taking a colleague's live chat for themselves.
 *  - PATCH wrote `assigned_agent_id` without checking the person was in
 *    this account; the assignment push then went to that person, with
 *    this account's customer's name in it.
 *
 * An agent may take an unassigned chat and give back their own; moving a
 * chat between people is for a supervisor and above.
 */

const h = vi.hoisted(() => ({
  role: 'agent' as string,
  assigned: null as string | null,
  writes: [] as unknown[],
  pushes: [] as string[],
}))

vi.mock('@/lib/auth/account', async () => {
  const db = (await import('@/lib/db')).prisma
  return {
    requireRole: () => Promise.resolve({ accountId: 'acc', userId: 'me', role: h.role, db }),
    toErrorResponse: (err: unknown) => {
      throw err
    },
  }
})
vi.mock('@/lib/push', () => ({ sendPushToUser: (id: string) => { h.pushes.push(id); return Promise.resolve() } }))
vi.mock('@/lib/ai/csat', () => ({ requestFeedback: () => Promise.resolve() }))
vi.mock('@/lib/db', () => {
  const conv = () => ({ id: 'cv1', account_id: 'acc', assigned_agent_id: h.assigned, status: 'open', contact: { name: 'Asha', phone: '+91' } })
  const update = (a: { data: Record<string, unknown> }) => { h.writes.push(a.data); return Promise.resolve({ ...conv(), ...a.data }) }
  return {
    prisma: {
      conversation: {
        findFirst: (a: { where: { assigned_agent_id?: string } }) =>
          Promise.resolve(a.where.assigned_agent_id && a.where.assigned_agent_id !== h.assigned ? null : conv()),
        update,
        updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const w = a.where as { assigned_agent_id?: unknown }
          const ok = !('assigned_agent_id' in w) || w.assigned_agent_id === h.assigned
          if (ok) h.writes.push(a.data)
          return Promise.resolve({ count: ok ? 1 : 0 })
        },
      },
      profile: {
        findFirst: (a: { where: { user_id: string; account_id: string } }) =>
          Promise.resolve(['me', 'colleague'].includes(a.where.user_id) && a.where.account_id === 'acc' ? { user_id: a.where.user_id } : null),
      },
    },
  }
})

import { POST as assign } from './assign/route'
import { PATCH } from './route'

const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as never
const params = { params: Promise.resolve({ id: 'cv1' }) }

describe('conversation assignment', () => {
  beforeEach(() => {
    h.writes = []
    h.pushes = []
    h.assigned = null
    h.role = 'agent'
  })

  it('an agent cannot take a colleague’s chat', async () => {
    h.assigned = 'colleague'
    expect((await assign(req({ agent_id: 'me' }), params)).status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it('an agent cannot hand a chat to somebody else', async () => {
    h.assigned = 'me'
    expect((await assign(req({ agent_id: 'colleague' }), params)).status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it('an agent can take an unassigned chat and give back their own', async () => {
    expect((await assign(req({ agent_id: 'me' }), params)).status).toBe(200)
    h.assigned = 'me'
    expect((await assign(req({ agent_id: null }), params)).status).toBe(200)
  })

  it('a supervisor can move any chat to anyone in the account', async () => {
    h.role = 'supervisor'
    h.assigned = 'colleague'
    expect((await assign(req({ agent_id: 'me' }), params)).status).toBe(200)
  })

  it('PATCH: nobody can assign a chat to a person outside the account', async () => {
    h.role = 'supervisor'
    const res = await PATCH(req({ assigned_agent_id: 'stranger' }), params)
    expect(res.status).toBe(400)
    expect(h.writes).toEqual([])
    expect(h.pushes).toEqual([])
  })

  it('PATCH: an agent cannot hand their chat to a colleague', async () => {
    h.assigned = 'me'
    expect((await PATCH(req({ assigned_agent_id: 'colleague' }), params)).status).toBe(403)
    expect(h.writes).toEqual([])
  })
})
