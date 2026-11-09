import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: a WhatsApp status update was applied to every message in the whole
 * database that carried the same WhatsApp id, whichever business it
 * belonged to, and the webhook never checked that the number the event came
 * in on was the business that owns the message. Money is about to hang off
 * these events, so one business's event must never touch another's rows.
 */

type Row = { id: string; status: string; conversation_id: string; conversation: { account_id: string } }

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  updated: [] as string[],
}))

vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findMany: ({ where }: { where: { message_id: string; conversation?: { account_id?: string } } }) => {
        const wanted = where.conversation?.account_id
        return Promise.resolve(
          h.rows.filter((r) => (wanted ? r.conversation.account_id === wanted : true)),
        )
      },
      updateMany: ({ where }: { where: { id: string } }) => {
        h.updated.push(where.id)
        return Promise.resolve({ count: 1 })
      },
    },
  },
}))

import { applyMessageStatus } from './message-status'

beforeEach(() => {
  h.updated = []
  h.rows = [
    { id: 'mine', status: 'sent', conversation_id: 'c1', conversation: { account_id: 'acc-A' } },
    { id: 'theirs', status: 'sent', conversation_id: 'c2', conversation: { account_id: 'acc-B' } },
  ]
})

describe('applyMessageStatus', () => {
  it('only moves the messages of the business the event came in for', async () => {
    await applyMessageStatus('wamid.X', 'delivered', 'acc-A')
    expect(h.updated).toEqual(['mine'])
  })

  it('still works the old way when no business is given', async () => {
    await applyMessageStatus('wamid.X', 'delivered')
    expect(h.updated.sort()).toEqual(['mine', 'theirs'])
  })
})
