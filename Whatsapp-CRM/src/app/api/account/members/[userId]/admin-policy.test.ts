import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Policy (lead decision): only the owner acts on admins. An admin could
 * demote a fellow admin to agent and then — because agent phone logins
 * may be handed a new password by an admin — take over that admin's
 * login. Admins now act only on supervisors, agents and viewers; the
 * owner acts on everybody but themself.
 */

const h = vi.hoisted(() => ({
  actor: 'admin' as string,
  target: 'admin' as string,
  updates: 0,
  deactivated: 0,
  passwords: 0,
}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'actor', accountId: 'acc', role: h.actor }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
  forgetCachedProfile: () => {},
}))
vi.mock('@/lib/auth/deactivate-member', () => ({
  deactivateMember: () => {
    h.deactivated++
    return Promise.resolve()
  },
}))
vi.mock('@/lib/auth/session-invalidation', () => ({ invalidateAllSessions: () => Promise.resolve() }))
vi.mock('bcryptjs', () => ({ default: { hash: () => Promise.resolve('h') } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findFirst: () =>
        Promise.resolve({
          user_id: 'target',
          account_role: h.target,
          email: '919876543210@agent.local',
          full_name: 'T',
          user: { email: '919876543210@agent.local' },
        }),
      update: () => {
        h.updates++
        return Promise.resolve({})
      },
    },
    user: {
      update: () => {
        h.passwords++
        return Promise.resolve({})
      },
    },
    serviceCategory: { findMany: () => Promise.resolve([]) },
  },
}))

import { DELETE, PATCH } from './route'
import { POST as resetPassword } from './password/route'

const params = { params: Promise.resolve({ userId: 'target' }) }
const patch = (body: unknown) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), params)
const del = () => DELETE(new Request('http://x', { method: 'DELETE' }), params)
const reset = () => resetPassword(new Request('http://x', { method: 'POST' }), params)

describe('who may act on an admin', () => {
  beforeEach(() => {
    h.updates = 0
    h.deactivated = 0
    h.passwords = 0
  })

  it('an admin cannot demote, edit or remove another admin', async () => {
    h.actor = 'admin'
    h.target = 'admin'
    expect((await patch({ role: 'agent' })).status).toBe(403)
    expect((await patch({ restrict_to_assigned: true })).status).toBe(403)
    expect((await del()).status).toBe(403)
    expect(h.updates).toBe(0)
    expect(h.deactivated).toBe(0)
  })

  it('an admin still manages supervisors, agents and viewers', async () => {
    h.actor = 'admin'
    for (const target of ['supervisor', 'agent', 'viewer']) {
      h.target = target
      expect((await patch({ role: 'viewer' })).status).toBe(200)
    }
    h.target = 'agent'
    expect((await reset()).status).toBe(200)
    expect((await del()).status).toBe(200)
  })

  it('the owner may act on an admin', async () => {
    h.actor = 'owner'
    h.target = 'admin'
    expect((await patch({ role: 'agent' })).status).toBe(200)
    expect((await del()).status).toBe(200)
  })

  it('nobody but the owner resets an admin’s or the owner’s password', async () => {
    h.actor = 'admin'
    for (const target of ['admin', 'owner']) {
      h.target = target
      expect((await reset()).status).toBeGreaterThanOrEqual(400)
    }
    expect(h.passwords).toBe(0)
  })
})
