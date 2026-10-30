import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Automations send messages, change contacts and call webhooks on their
 * own, for everybody. The routes asked only that somebody be signed in,
 * so a viewer — the read-only rank — or a member the admin had kept off
 * the Automations page could create and switch one on.
 */

const h = vi.hoisted(() => ({ role: 'viewer' as string, pages: null as string[] | null, created: 0 }))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: 'viewer' | 'agent' | 'supervisor' | 'admin' | 'owner') => {
      if (!hasMinRole(h.role as never, min)) throw new actual.ForbiddenError(`This action requires the '${min}' role or higher`)
      return { accountId: 'acc', userId: 'u1', role: h.role, pageAccess: h.pages }
    },
  }
})
vi.mock('@/lib/automations/steps-tree', () => ({ insertSteps: () => Promise.resolve(null), loadStepsTree: () => Promise.resolve([]), replaceSteps: () => Promise.resolve(null) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: () => Promise.resolve({ account_id: 'acc' }) },
    automation: {
      create: (a: { data: object }) => { h.created++; return Promise.resolve({ id: 'a1', ...a.data }) },
      findMany: () => Promise.resolve([]),
      findFirst: () => Promise.resolve({ id: 'a1', account_id: 'acc', user_id: 'u1', name: 'A', trigger_type: 'manual', trigger_config: {}, is_active: false }),
      delete: () => { h.created-- ; return Promise.resolve({}) },
    },
  },
}))

import { POST } from './route'
import { DELETE } from './[id]/route'

const create = () =>
  POST(new Request('http://x/api/automations', { method: 'POST', body: JSON.stringify({ name: 'A', trigger_type: 'manual' }) }))

describe('automations need a rank and the page', () => {
  beforeEach(() => {
    h.created = 0
    h.pages = null
  })

  it('a viewer cannot create one', async () => {
    h.role = 'viewer'
    expect((await create()).status).toBe(403)
    expect(h.created).toBe(0)
  })

  it('an agent without the Automations page cannot either', async () => {
    h.role = 'agent'
    expect((await create()).status).toBe(403)
    expect(h.created).toBe(0)
  })

  it('a viewer cannot delete one', async () => {
    h.role = 'viewer'
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id: 'a1' }) })
    expect(res.status).toBe(403)
    expect(h.created).toBe(0)
  })

  it('a supervisor can, and so can an agent an admin gave the page to', async () => {
    h.role = 'supervisor'
    expect((await create()).status).toBe(201)
    h.role = 'agent'
    h.pages = ['/automations']
    expect((await create()).status).toBe(201)
  })
})
