import { beforeEach, describe, expect, it, vi } from 'vitest'

// The first reply a person gave a lead is stamped once, on that contact's
// open leads in that account, and only leads that existed before the reply.

type Lead = {
  id: string
  account_id: string
  contact_id: string
  status: string
  created_at: Date
  first_response_at: Date | null
  first_response_by: string | null
}

type Where = {
  account_id: string
  contact_id: string
  first_response_at: null
  created_at: { lte: Date }
  status: { not: string }
}

const h = vi.hoisted(() => ({ leads: [] as Lead[], fail: false }))

vi.mock('@/lib/db', () => ({
  prisma: {
    lead: {
      // Applies the where clause the way Postgres would, so the test checks
      // the condition itself rather than the shape of the call.
      updateMany: async ({ where, data }: { where: Where; data: Partial<Lead> }) => {
        if (h.fail) throw new Error('db down')
        let count = 0
        for (const l of h.leads) {
          if (
            l.account_id === where.account_id &&
            l.contact_id === where.contact_id &&
            l.first_response_at === where.first_response_at &&
            l.created_at.getTime() <= where.created_at.lte.getTime() &&
            l.status !== where.status.not
          ) {
            Object.assign(l, data)
            count++
          }
        }
        return { count }
      },
    },
  },
}))

import { stampFirstResponse } from './first-response'

const T0 = new Date('2026-11-07T09:00:00+05:30')
const lead = (o: Partial<Lead>): Lead => ({
  id: 'l',
  account_id: 'acc',
  contact_id: 'c1',
  status: 'new',
  created_at: new Date(T0.getTime() - 60_000),
  first_response_at: null,
  first_response_by: null,
  ...o,
})

beforeEach(() => {
  h.leads = []
  h.fail = false
})

describe('stampFirstResponse', () => {
  it('stamps the first reply once; a later reply changes nothing', async () => {
    h.leads = [lead({ id: 'l1' })]
    expect(await stampFirstResponse({ accountId: 'acc', contactId: 'c1', userId: 'agent-1', at: T0 })).toBe(1)
    const later = new Date(T0.getTime() + 5 * 60_000)
    expect(await stampFirstResponse({ accountId: 'acc', contactId: 'c1', userId: 'agent-2', at: later })).toBe(0)
    expect(h.leads[0]).toMatchObject({ first_response_at: T0, first_response_by: 'agent-1' })
  })

  it('only this account’s leads, only this contact’s', async () => {
    h.leads = [lead({ id: 'other-acc', account_id: 'other' }), lead({ id: 'other-contact', contact_id: 'c2' })]
    expect(await stampFirstResponse({ accountId: 'acc', contactId: 'c1', userId: 'agent-1', at: T0 })).toBe(0)
    expect(h.leads.every((l) => l.first_response_at === null)).toBe(true)
  })

  it('skips closed leads and leads created after the reply', async () => {
    h.leads = [
      lead({ id: 'closed', status: 'closed' }),
      lead({ id: 'future', created_at: new Date(T0.getTime() + 1000) }),
      lead({ id: 'open', status: 'follow_up' }),
    ]
    expect(await stampFirstResponse({ accountId: 'acc', contactId: 'c1', userId: 'agent-1', at: T0 })).toBe(1)
    expect(h.leads.find((l) => l.first_response_at)?.id).toBe('open')
  })

  it('never throws', async () => {
    h.fail = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(stampFirstResponse({ accountId: 'acc', contactId: 'c1', userId: 'agent-1' })).resolves.toBe(0)
    err.mockRestore()
  })

  it('does nothing without a person', async () => {
    h.leads = [lead({})]
    expect(await stampFirstResponse({ accountId: 'acc', contactId: 'c1', userId: '' })).toBe(0)
    expect(h.leads[0].first_response_at).toBeNull()
  })
})
