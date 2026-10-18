import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Found 18 Oct: any message from a contact counted as a reply to the last
 * broadcast they got — even weeks later, about something else entirely —
 * so "Replied" kept growing and "Read, no reply" kept shrinking.
 */

const h = vi.hoisted(() => ({ where: null as Record<string, unknown> | null, updated: [] as string[] }))

vi.mock('@/lib/db', () => ({
  prisma: {
    broadcastRecipient: {
      findFirst: (a: { where: Record<string, unknown> }) => {
        h.where = a.where
        return Promise.resolve({ id: 'r1' })
      },
      update: (a: { where: { id: string } }) => {
        h.updated.push(a.where.id)
        return Promise.resolve({ broadcast_id: 'b1' })
      },
    },
  },
}))
vi.mock('./counts', () => ({ refreshBroadcastCounts: () => Promise.resolve() }))

import { attributeBroadcastReply, REPLY_WINDOW_HOURS } from './replies'

beforeEach(() => {
  h.where = null
  h.updated = []
})

describe('a reply to a broadcast', () => {
  it('counts only within the reply window after it was sent', async () => {
    const now = new Date('2026-10-18T12:00:00Z')
    await attributeBroadcastReply('acc', 'c1', now)
    expect(REPLY_WINDOW_HOURS).toBe(72)
    expect(h.where).toMatchObject({
      contact_id: 'c1',
      status: { in: ['sent', 'delivered', 'read'] },
      broadcast: { account_id: 'acc' },
      sent_at: { gte: new Date('2026-10-15T12:00:00Z') },
    })
    expect(h.updated).toEqual(['r1'])
  })
})
