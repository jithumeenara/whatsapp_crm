import { beforeEach, describe, expect, it, vi } from 'vitest'

// A lead remembers the WhatsApp number and the click-to-WhatsApp ad it
// came from (reports, migration 158) — read from that contact's chats in
// the same account, and never at the cost of the lead itself.

type Conv = {
  id: string
  account_id: string
  contact_id: string
  whatsapp_config_id: string | null
  ctwa_source_id: string | null
  last_message_at: Date | null
  created_at: Date
}

const h = vi.hoisted(() => ({
  convs: [] as Conv[],
  fail: false,
  calls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findFirst: async (q: { where: Partial<Conv>; orderBy?: unknown }) => {
        h.calls.push(q.where as Record<string, unknown>)
        if (h.fail) throw new Error('db down')
        const rows = h.convs.filter((c) =>
          Object.entries(q.where).every(([k, v]) => (c as Record<string, unknown>)[k] === v),
        )
        // Newest by last message, chats with none last; then newest created.
        rows.sort((a, b) => {
          const la = a.last_message_at?.getTime() ?? -Infinity
          const lb = b.last_message_at?.getTime() ?? -Infinity
          if (la !== lb) return lb - la
          return b.created_at.getTime() - a.created_at.getTime()
        })
        const r = rows[0]
        return r ? { whatsapp_config_id: r.whatsapp_config_id, ctwa_source_id: r.ctwa_source_id } : null
      },
    },
  },
}))

import { leadOrigin } from './origin'

const conv = (o: Partial<Conv>): Conv => ({
  id: 'x',
  account_id: 'acc',
  contact_id: 'c1',
  whatsapp_config_id: null,
  ctwa_source_id: null,
  last_message_at: null,
  created_at: new Date('2026-11-01T00:00:00Z'),
  ...o,
})

beforeEach(() => {
  h.convs = []
  h.fail = false
  h.calls = []
})

describe('leadOrigin', () => {
  it('takes the number and the ad from the contact’s newest chat', async () => {
    h.convs = [
      conv({ id: 'old', whatsapp_config_id: 'wa-old', ctwa_source_id: null, last_message_at: new Date('2026-11-01T10:00:00Z') }),
      conv({ id: 'new', whatsapp_config_id: 'wa-new', ctwa_source_id: 'ad-42', last_message_at: new Date('2026-11-05T10:00:00Z') }),
      conv({ id: 'empty', whatsapp_config_id: 'wa-empty', last_message_at: null, created_at: new Date('2026-11-06T00:00:00Z') }),
    ]
    expect(await leadOrigin({ accountId: 'acc', contactId: 'c1' })).toEqual({ whatsapp_config_id: 'wa-new', ad_id: 'ad-42' })
  })

  it('uses the named chat when the caller knows it', async () => {
    h.convs = [
      conv({ id: 'a', whatsapp_config_id: 'wa-a', last_message_at: new Date('2026-11-01T10:00:00Z') }),
      conv({ id: 'b', whatsapp_config_id: 'wa-b', last_message_at: new Date('2026-11-05T10:00:00Z') }),
    ]
    expect(await leadOrigin({ accountId: 'acc', contactId: 'c1', conversationId: 'a' })).toEqual({ whatsapp_config_id: 'wa-a', ad_id: null })
  })

  it('never reads another account’s chat, even by its id', async () => {
    h.convs = [conv({ id: 'theirs', account_id: 'other', whatsapp_config_id: 'wa-theirs', ctwa_source_id: 'ad-x', last_message_at: new Date() })]
    expect(await leadOrigin({ accountId: 'acc', contactId: 'c1', conversationId: 'theirs' })).toEqual({ whatsapp_config_id: null, ad_id: null })
    expect(await leadOrigin({ accountId: 'acc', contactId: 'c1' })).toEqual({ whatsapp_config_id: null, ad_id: null })
    expect(h.calls.every((w) => w.account_id === 'acc')).toBe(true)
  })

  it('a chat id that belongs to another contact falls back to this contact’s own chats', async () => {
    h.convs = [
      conv({ id: 'someone-else', contact_id: 'c2', whatsapp_config_id: 'wa-2', last_message_at: new Date() }),
      conv({ id: 'mine', whatsapp_config_id: 'wa-1', last_message_at: new Date('2026-11-01T00:00:00Z') }),
    ]
    expect(await leadOrigin({ accountId: 'acc', contactId: 'c1', conversationId: 'someone-else' })).toEqual({ whatsapp_config_id: 'wa-1', ad_id: null })
  })

  it('no contact and no chat: nothing to look up', async () => {
    expect(await leadOrigin({ accountId: 'acc', contactId: null })).toEqual({ whatsapp_config_id: null, ad_id: null })
    expect(h.calls).toHaveLength(0)
  })

  it('never throws — a failed lookup gives empty values', async () => {
    h.fail = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(leadOrigin({ accountId: 'acc', contactId: 'c1', conversationId: 'a' })).resolves.toEqual({ whatsapp_config_id: null, ad_id: null })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
