import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Who sees what on the owner dashboard. Same rule as GET /api/dashboard. */

const h = vi.hoisted(() => ({ flag: false, missing: false }))
vi.mock('@/lib/db', () => ({
  prisma: { profile: { findUnique: async () => (h.missing ? null : { restrict_to_assigned: h.flag }) } },
}))

import { resolveDashboardScope } from './scope'

const scope = (role: string) => resolveDashboardScope({ userId: 'me', role } as never)

beforeEach(() => { h.flag = false; h.missing = false })

describe('resolveDashboardScope', () => {
  it('owner and admin: whole team, with money', async () => {
    expect(await scope('owner')).toEqual({ view: 'owner', money: true, userId: null })
    expect(await scope('admin')).toEqual({ view: 'owner', money: true, userId: null })
  })
  it('supervisor: whole team, no money', async () => {
    expect(await scope('supervisor')).toEqual({ view: 'team', money: false, userId: null })
  })
  it('agent and viewer: their own numbers only', async () => {
    expect(await scope('agent')).toEqual({ view: 'agent', money: false, userId: 'me' })
    expect(await scope('viewer')).toEqual({ view: 'agent', money: false, userId: 'me' })
  })
  it('"assigned only" narrows a supervisor, an admin and even an owner to their own work', async () => {
    h.flag = true
    for (const role of ['supervisor', 'admin', 'owner']) {
      expect(await scope(role)).toEqual({ view: 'agent', money: false, userId: 'me' })
    }
  })
  it('a missing profile row does not widen anything for an agent', async () => {
    h.missing = true
    expect(await scope('agent')).toEqual({ view: 'agent', money: false, userId: 'me' })
  })
})
