import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Event-based broadcasts: a tag event queues each person once, after the
 * delay; the opposite event calls off a wait that has not been sent.
 */

const h = vi.hoisted(() => ({
  campaigns: [] as Array<{ id: string; event_tag_id: string; event_delay_minutes: number; event_trigger: string }>,
  recipients: [] as Array<{ broadcast_id: string; contact_id: string; status: string; send_after?: Date }>,
  calledOff: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => {
  const tx = {
    $executeRaw: () => Promise.resolve(1),
    broadcastRecipient: {
      findMany: (a: { where: { broadcast_id: string; contact_id: { in: string[] } } }) =>
        Promise.resolve(h.recipients.filter((r) => r.broadcast_id === a.where.broadcast_id && a.where.contact_id.in.includes(r.contact_id))),
      createMany: (a: { data: typeof h.recipients }) => {
        h.recipients.push(...a.data)
        return Promise.resolve({ count: a.data.length })
      },
    },
    broadcast: { update: () => Promise.resolve({}) },
  }
  return {
    prisma: {
      broadcast: {
        findMany: (a: { where: { event_trigger: string; event_tag_id: { in: string[] } } }) =>
          Promise.resolve(h.campaigns.filter((c) => c.event_trigger === a.where.event_trigger && a.where.event_tag_id.in.includes(c.event_tag_id))),
      },
      contact: {
        findMany: (a: { where: { AND: Array<{ id?: { in: string[] } }> } }) =>
          Promise.resolve((a.where.AND.find((w) => w.id)?.id?.in ?? []).map((id) => ({ id }))),
      },
      broadcastRecipient: {
        updateMany: (a: Record<string, unknown>) => {
          h.calledOff.push(a)
          return Promise.resolve({ count: 1 })
        },
      },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  }
})

import { onTagEvent } from './events'

beforeEach(() => {
  h.campaigns = [{ id: 'welcome', event_tag_id: 'paid', event_delay_minutes: 60, event_trigger: 'tag_added' }]
  h.recipients = []
  h.calledOff = []
})

describe('event-based broadcasts', () => {
  it('queues the person after the delay when their tag is added', async () => {
    const now = Date.now()
    const r = await onTagEvent({ accountId: 'acc', event: 'tag_added', pairs: [{ contactId: 'c1', tagId: 'paid' }] })
    expect(r.queued).toBe(1)
    expect(h.recipients[0]).toMatchObject({ broadcast_id: 'welcome', contact_id: 'c1', status: 'pending' })
    expect(h.recipients[0].send_after!.getTime()).toBeGreaterThanOrEqual(now + 59 * 60_000)
  })

  it('sends to each person once, even if the tag is added again', async () => {
    await onTagEvent({ accountId: 'acc', event: 'tag_added', pairs: [{ contactId: 'c1', tagId: 'paid' }] })
    const again = await onTagEvent({ accountId: 'acc', event: 'tag_added', pairs: [{ contactId: 'c1', tagId: 'paid' }] })
    expect(again.queued).toBe(0)
    expect(h.recipients).toHaveLength(1)
  })

  it('ignores other tags', async () => {
    const r = await onTagEvent({ accountId: 'acc', event: 'tag_added', pairs: [{ contactId: 'c1', tagId: 'lead' }] })
    expect(r.queued).toBe(0)
  })

  it('calls off a waiting "Tag added" message when the tag is removed', async () => {
    await onTagEvent({ accountId: 'acc', event: 'tag_removed', pairs: [{ contactId: 'c1', tagId: 'paid' }] })
    expect(h.calledOff[0]).toMatchObject({
      where: { status: 'pending', contact_id: { in: ['c1'] }, broadcast: { account_id: 'acc', event_trigger: 'tag_added', event_tag_id: 'paid' } },
      data: { status: 'skipped' },
    })
  })
})
