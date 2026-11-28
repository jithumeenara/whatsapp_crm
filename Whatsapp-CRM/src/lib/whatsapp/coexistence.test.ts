import { beforeEach, describe, expect, it, vi } from 'vitest'

// Coexistence (WhatsApp Business app + CRM on one number): a message sent
// from the phone shows in the Inbox as sent by a person, once; history is
// imported without unread counts or emits; a declined history is recorded;
// the one-time sync request is never made twice.

const h = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  sql: [] as string[],
  claimed: true,
  emits: [] as string[],
  fetches: [] as string[],
}))

vi.mock('@/lib/socket', () => ({ emitToAccount: (_a: string, ev: string) => { h.emits.push(ev) } }))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: async () => ({ id: 'contact-1', phone: '919800000001', name: '919800000001' }),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({ META_API_BASE: 'https://graph.facebook.com/v27.0' }))
vi.mock('@prisma/client', () => ({
  // Nested fragments are spliced in, as Prisma does, so a test can read the whole statement.
  Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ text: s.reduce((acc, part, i) => acc + part + (i < v.length ? ((v[i] as { text?: string })?.text ?? '?') : ''), ''), v }) },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    whatsAppConfig: {
      findMany: async () => [{ id: 'cfg-1', account_id: 'acc-1', user_id: 'u-1', phone_number_id: 'pn-1' }],
      findUnique: async () => ({ id: 'cfg-1', account_id: 'acc-1', user_id: 'u-1', phone_number_id: 'pn-1' }),
    },
    contact: { update: async () => ({}), create: async () => ({ id: 'contact-1' }) },
    conversation: {
      findFirst: async () => ({ id: 'conv-1' }),
      create: async () => ({ id: 'conv-1' }),
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ id: 'conv-1' }),
    },
    message: {
      findFirst: async ({ where }: { where: { message_id: string } }) => h.messages.find((m) => m.message_id === where.message_id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `m${h.messages.length}`, ...data }; h.messages.push(row); return row },
      update: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    // Chunk storage fails here, so changes are processed directly (the no-table path).
    $executeRaw: async (q: { text: string }) => { h.sql.push(q.text); if (q.text.includes('INSERT INTO whatsapp_history_chunks')) throw new Error('no table'); return 1 },
    $queryRaw: async (q: { text: string }) => { h.sql.push(q.text); return h.claimed ? [{ whatsapp_config_id: 'cfg-1' }] : [] },
  },
}))

import { handleCoexistenceChange, messageContent, requestCoexistenceSync, isCoexistenceField } from './coexistence'

const meta = { display_phone_number: '91 98765 43210', phone_number_id: 'pn-1' }

beforeEach(() => {
  h.messages = []; h.sql = []; h.claimed = true; h.emits = []; h.fetches = []
  vi.stubGlobal('fetch', async (url: string) => { h.fetches.push(url); return new Response(JSON.stringify({ request_id: 'r1' }), { status: 200 }) })
})

describe('coexistence', () => {
  it('knows its three webhook fields', () => {
    expect(['smb_message_echoes', 'history', 'smb_app_state_sync'].every(isCoexistenceField)).toBe(true)
    expect(isCoexistenceField('messages')).toBe(false)
  })

  it('a message sent from the phone shows as sent by a person, once', async () => {
    const value = { metadata: meta, message_echoes: [{ from: '919876543210', to: '919800000001', id: 'wamid.A', timestamp: '1764300000', type: 'text', text: { body: 'Hi from phone' } }] }
    await handleCoexistenceChange('smb_message_echoes', value)
    await handleCoexistenceChange('smb_message_echoes', value)
    expect(h.messages).toHaveLength(1)
    expect(h.messages[0]).toMatchObject({ sender_type: 'agent', bot_source: 'phone_app', content_text: 'Hi from phone', message_id: 'wamid.A' })
    expect(h.emits).toContain('message')
  })

  it('imports history by direction, without emits, and records progress', async () => {
    await handleCoexistenceChange('history', {
      metadata: meta,
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: '919800000001', messages: [
        { from: '919800000001', id: 'wamid.C1', timestamp: '1764000000', type: 'text', text: { body: 'Fees?' } },
        { from: '919876543210', to: '919800000001', id: 'wamid.B1', timestamp: '1764000100', type: 'text', text: { body: '5900' }, history_context: { status: 'READ' } },
      ] }] }],
    })
    expect(h.messages.map((m) => [m.message_id, m.sender_type, m.status])).toEqual([
      ['wamid.C1', 'customer', 'delivered'],
      ['wamid.B1', 'agent', 'read'],
    ])
    expect(h.emits).toEqual([])
    expect(h.sql.some((t) => t.includes('history_progress'))).toBe(true)
  })

  it('a declined history is recorded', async () => {
    await handleCoexistenceChange('history', { metadata: meta, history: [{ errors: [{ code: 2593109 }] }] })
    expect(h.sql.some((t) => t.includes("history_status = 'declined'"))).toBe(true)
    expect(h.messages).toHaveLength(0)
  })

  it('the one-time sync asks for contacts then history, and never twice', async () => {
    await requestCoexistenceSync({ configId: 'cfg-1', accountId: 'acc-1', phoneNumberId: 'pn-1', accessToken: 't' })
    expect(h.fetches).toEqual(['https://graph.facebook.com/v27.0/pn-1/smb_app_data', 'https://graph.facebook.com/v27.0/pn-1/smb_app_data'])
    h.fetches = []; h.claimed = false
    expect((await requestCoexistenceSync({ configId: 'cfg-1', accountId: 'acc-1', phoneNumberId: 'pn-1', accessToken: 't' })).requested).toBe(false)
    expect(h.fetches).toEqual([])
  })

  it('media goes through the media proxy; odd ids are refused', () => {
    expect(messageContent({ type: 'image', image: { id: '12345', caption: 'pic', mime_type: 'image/jpeg' } })).toMatchObject({ contentType: 'image', mediaUrl: '/api/whatsapp/media/12345', text: 'pic' })
    expect(messageContent({ type: 'image', image: { id: '../x?y' } }).mediaUrl).toBeNull()
  })
})
