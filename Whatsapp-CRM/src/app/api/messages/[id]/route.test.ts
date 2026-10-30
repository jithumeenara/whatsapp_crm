import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * DELETE /api/messages/[id] checked only that the message was in the
 * caller's account: a viewer — read-only — could delete messages, an
 * agent could delete them in a colleague's chats, and the platform
 * message id to unsend came from the request body, so any message on the
 * page could be unsent in the customer's app by naming its id.
 */

const h = vi.hoisted(() => ({ role: 'viewer' as string, assigned: 'me' as string | null, unsent: [] as string[], deleted: 0 }))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'me' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: 'viewer' | 'agent' | 'supervisor' | 'admin' | 'owner') => {
      if (!hasMinRole(h.role as never, min)) throw new actual.ForbiddenError(`This action requires the '${min}' role or higher`)
      return { accountId: 'acc', userId: 'me', role: h.role }
    },
  }
})
vi.mock('@/lib/db/schema-patch', () => ({ onceSchemaPatch: () => Promise.resolve() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: () => Promise.resolve({ account_id: 'acc' }) },
    message: {
      findFirst: () =>
        Promise.resolve({ id: 'm1', message_id: 'mid-of-this-message', conversation: { account_id: 'acc', channel: 'instagram', assigned_agent_id: h.assigned } }),
    },
    $executeRaw: () => { h.deleted++; return Promise.resolve(1) },
    $queryRaw: () => ({ catch: () => Promise.resolve([{ access_token: 'tok' }]), then: (r: (v: unknown) => unknown) => Promise.resolve([{ access_token: 'tok' }]).then(r) }),
  },
}))

import { DELETE } from './route'

const del = (body: unknown = {}) =>
  DELETE(new Request('http://x', { method: 'DELETE', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'm1' }) })

describe('DELETE /api/messages/[id]', () => {
  beforeEach(() => {
    h.unsent = []
    h.deleted = 0
    h.assigned = 'me'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { h.unsent.push(String(url)); return new Response('{}', { status: 200 }) }))
  })

  it('a viewer cannot delete a message', async () => {
    h.role = 'viewer'
    expect((await del()).status).toBe(403)
    expect(h.deleted).toBe(0)
  })

  it('an agent cannot delete one in a colleague’s chat', async () => {
    h.role = 'agent'
    h.assigned = 'colleague'
    expect((await del()).status).toBe(404)
    expect(h.deleted).toBe(0)
  })

  it('the platform id unsent is the message’s own, never one from the body', async () => {
    h.role = 'agent'
    expect((await del({ message_id: 'some-other-message' })).status).toBe(200)
    expect(h.unsent.join()).toContain('mid-of-this-message')
    expect(h.unsent.join()).not.toContain('some-other-message')
  })
})
