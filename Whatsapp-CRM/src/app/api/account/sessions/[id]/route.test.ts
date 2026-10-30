import { describe, expect, it, vi } from 'vitest'

/**
 * Logging one device out revoked its session but left that device's open
 * tab on the live-update socket, still receiving the account's messages.
 * The person's sockets are now closed; tabs on devices that are still
 * signed in reconnect on their own with a fresh ticket, the revoked one
 * cannot get one.
 */

const h = vi.hoisted(() => ({ disconnected: [] as string[], revoked: 0 }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1' }, sessionId: 'here' }) }))
vi.mock('@/lib/socket', () => ({ disconnectUserSockets: (id: string) => h.disconnected.push(id) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    userSession: {
      findFirst: ({ where }: { where: { id: string; user_id: string } }) =>
        Promise.resolve(where.user_id === 'u1' && where.id === 'phone' ? { id: 'phone', revoked_at: null } : null),
      update: () => {
        h.revoked++
        return Promise.resolve({})
      },
    },
  },
}))

import { DELETE } from './route'

const del = (id: string) => DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id }) })

describe('logging one device out', () => {
  it('revokes it and closes the person’s live connections', async () => {
    expect((await del('phone')).status).toBe(200)
    expect(h.revoked).toBe(1)
    expect(h.disconnected).toEqual(['u1'])
  })

  it('cannot touch somebody else’s session', async () => {
    h.disconnected = []
    expect((await del('not-mine')).status).toBe(404)
    expect(h.disconnected).toEqual([])
  })
})
