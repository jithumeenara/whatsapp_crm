import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Importing recent conversations: the customer is the participant who is not
 * us; our own replies are saved as the team's; a message already saved is
 * skipped (idempotent); only Meta's own hosts are followed; nothing else runs.
 */

const h = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  contacts: [] as Array<Record<string, unknown>>,
  fetched: [] as string[],
  next: null as string | null,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string | null) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async () => [{ access_token: 'EAApage', page_id: '1029' }],
    profile: { findFirst: async () => ({ user_id: 'owner' }) },
    contact: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => h.contacts.find((c) => c.facebook_id === where.facebook_id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const c = { id: `c${h.contacts.length + 1}`, ...data }; h.contacts.push(c); return { id: c.id } },
    },
    conversation: { findFirst: async () => ({ id: 'conv-1' }), create: async () => ({ id: 'conv-1' }), updateMany: async () => ({ count: 1 }) },
    message: {
      findFirst: async ({ where }: { where: { message_id: string } }) => h.messages.find((m) => m.message_id === where.message_id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { h.messages.push(data); return data },
    },
  },
}))

import { importConversations } from './social-import'

beforeEach(() => {
  h.messages = []; h.contacts = []; h.fetched = []; h.next = null
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    h.fetched.push(u)
    return new Response(JSON.stringify({
      data: [{
        participants: { data: [{ id: '1029', name: 'Our Page' }, { id: '7654321', name: 'Asha K' }] },
        messages: { data: [
          { id: 'm_1', created_time: '2026-11-20T10:00:00+0000', from: { id: '7654321' }, message: 'Is admission open?' },
          { id: 'm_2', created_time: '2026-11-20T10:05:00+0000', from: { id: '1029' }, message: 'Yes, until 30 Nov.' },
        ] },
      }],
      paging: h.next ? { next: h.next } : {},
    }), { status: 200 })
  }))
})

describe('importing recent conversations', () => {
  it('the customer becomes a contact; their words and our replies are kept with the right sides', async () => {
    expect(await importConversations('acc-1', 'facebook')).toEqual({ conversations: 1, messages: 2 })
    expect(h.contacts[0]).toMatchObject({ facebook_id: '7654321', name: 'Asha K', opt_in_source: 'facebook_import' })
    expect(h.messages.map((m) => [m.message_id, m.sender_type])).toEqual([['m_1', 'customer'], ['m_2', 'agent']])
    expect(h.fetched[0].startsWith('https://graph.facebook.com/v27.0/1029/conversations?platform=messenger')).toBe(true)
  })
  it('running it again adds nothing (idempotent)', async () => {
    await importConversations('acc-1', 'facebook')
    expect(await importConversations('acc-1', 'facebook')).toEqual({ conversations: 1, messages: 0 })
    expect(h.messages).toHaveLength(2)
    expect(h.contacts).toHaveLength(1)
  })
  it('a "next" link to anywhere but Meta is never followed', async () => {
    h.next = 'https://169.254.169.254/latest/meta-data'
    await importConversations('acc-1', 'facebook')
    expect(h.fetched).toHaveLength(1)
  })
})
