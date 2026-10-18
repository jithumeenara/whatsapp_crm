import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (18 Oct 2026): blue ticks never reached an open chat. The status
 * webhook wrote the new status to the message row and told nobody, so the
 * Inbox showed one grey tick until the chat was reopened. And it wrote
 * whatever arrived: a "delivered" Meta sent after "read" turned a read
 * message back to two grey ticks.
 */

const h = vi.hoisted(() => ({
  messages: [] as Array<{ id: string; message_id: string; status: string; conversation_id: string; account_id: string }>,
  emitted: [] as Array<{ accountId: string; event: string; data: { eventType: string; new: Record<string, unknown> } }>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findMany: (a: { where: { message_id: string } }) =>
        Promise.resolve(
          h.messages
            .filter((m) => m.message_id === a.where.message_id)
            .map((m) => ({ id: m.id, status: m.status, conversation_id: m.conversation_id, conversation: { account_id: m.account_id } })),
        ),
      updateMany: (a: { where: { id?: string; message_id?: string; status?: string }; data: { status: string } }) => {
        let n = 0
        for (const m of h.messages) {
          if (a.where.id && m.id !== a.where.id) continue
          if (a.where.message_id && m.message_id !== a.where.message_id) continue
          if (a.where.status && m.status !== a.where.status) continue
          m.status = a.data.status
          n++
        }
        return Promise.resolve({ count: n })
      },
    },
  },
}))
vi.mock('@/lib/socket', () => ({
  emitToAccount: (accountId: string, event: string, data: never) => { h.emitted.push({ accountId, event, data }) },
}))

import { applyMessageStatus } from './message-status'

beforeEach(() => {
  h.messages = [{ id: 'm1', message_id: 'wamid.1', status: 'sent', conversation_id: 'c1', account_id: 'acc' }]
  h.emitted = []
})

describe('blue ticks', () => {
  it('reach the open chat as soon as WhatsApp reports them', async () => {
    await applyMessageStatus('wamid.1', 'read')
    expect(h.messages[0].status).toBe('read')
    expect(h.emitted).toEqual([
      { accountId: 'acc', event: 'message', data: { eventType: 'UPDATE', new: { id: 'm1', status: 'read', conversation_id: 'c1' }, old: {} } },
    ])
  })

  it('never go backwards when "delivered" arrives after "read"', async () => {
    await applyMessageStatus('wamid.1', 'read')
    h.emitted = []
    await applyMessageStatus('wamid.1', 'delivered')
    expect(h.messages[0].status).toBe('read')
    expect(h.emitted).toEqual([])
  })

  it('a failure after delivery is ignored', async () => {
    h.messages[0].status = 'delivered'
    await applyMessageStatus('wamid.1', 'failed')
    expect(h.messages[0].status).toBe('delivered')
  })
})
