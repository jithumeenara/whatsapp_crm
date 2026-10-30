import { describe, expect, it, vi } from 'vitest'

/**
 * Ending every session (sign out everywhere, member removed, password
 * reset by an admin) left that person's open tabs connected to the live
 * updates, still receiving the account's messages until the connection
 * aged out. It now closes their sockets in the same breath.
 */

const h = vi.hoisted(() => ({ disconnected: [] as string[] }))
vi.mock('@/lib/socket', () => ({ disconnectUserSockets: (id: string) => h.disconnected.push(id) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { update: () => Promise.resolve({}), findUnique: () => Promise.resolve(null) },
    userSession: { updateMany: () => Promise.resolve({ count: 1 }) },
  },
}))

import { getSessionInvalidatedAt, invalidateAllSessions } from './session-invalidation'

describe('ending every session', () => {
  it('closes the person’s live connections and refuses older tokens at once', async () => {
    await invalidateAllSessions('u1')
    expect(h.disconnected).toEqual(['u1'])
    expect(await getSessionInvalidatedAt('u1')).toBeInstanceOf(Date)
  })
})
