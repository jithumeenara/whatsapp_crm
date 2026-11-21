import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Messenger / Instagram events that are not a new customer message:
 * reactions, edits, unsends, replies typed in the Meta apps (echoes) and
 * Meta Business AI hand-overs. Every lookup is limited to the one
 * conversation, so an id from another workspace can never be touched.
 */

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; conversation_id: string; message_id: string; sender_type: string }>,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  reactions: [] as Array<Record<string, unknown>>,
  removed: [] as Array<Record<string, unknown>>,
  emitted: [] as string[],
}))

vi.mock('@/lib/socket', () => ({ emitToAccount: (_a: string, ev: string) => { h.emitted.push(ev) } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findFirst: async ({ where }: { where: { conversation_id: string; message_id: string; sender_type?: string } }) =>
        h.rows.find((r) => r.conversation_id === where.conversation_id && r.message_id === where.message_id && (!where.sender_type || r.sender_type === where.sender_type)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { h.created.push(data); return { id: 'new', ...data } },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { h.updated.push({ id: where.id, ...data }); return { id: where.id, ...data } },
    },
    messageReaction: {
      upsert: async (a: Record<string, unknown>) => { h.reactions.push(a) },
      deleteMany: async (a: Record<string, unknown>) => { h.removed.push(a) },
    },
  },
}))

import { applySocialDelete, applySocialEdit, applySocialReaction, attachmentsToRows, noteBusinessAiHandoff, saveSocialEcho } from './social-inbound'

beforeEach(() => {
  h.rows = [{ id: 'row-1', conversation_id: 'conv-1', message_id: 'mid.1', sender_type: 'customer' }, { id: 'row-2', conversation_id: 'conv-1', message_id: 'mid.staff', sender_type: 'agent' }]
  h.created = []; h.updated = []; h.reactions = []; h.removed = []; h.emitted = []
})

describe('reactions', () => {
  it('a customer reaction is stored on our row', async () => {
    await applySocialReaction({ accountId: 'a', conversationId: 'conv-1', contactId: 'c', targetMid: 'mid.1', emoji: '❤️' })
    expect(h.reactions).toHaveLength(1)
    expect(JSON.stringify(h.reactions[0])).toContain('row-1')
  })
  it('unreact removes only that customer\'s reaction', async () => {
    await applySocialReaction({ accountId: 'a', conversationId: 'conv-1', contactId: 'c', targetMid: 'mid.1', emoji: null })
    expect(h.removed[0]).toEqual({ where: { message_id: 'row-1', actor_type: 'customer', actor_id: 'c' } })
  })
  it('a message id from another conversation is ignored', async () => {
    await applySocialReaction({ accountId: 'a', conversationId: 'conv-2', contactId: 'c', targetMid: 'mid.1', emoji: '👍' })
    expect(h.reactions).toEqual([])
  })
})

describe('edits and unsends', () => {
  it('an edit replaces the text, capped in length', async () => {
    await applySocialEdit({ accountId: 'a', conversationId: 'conv-1', mid: 'mid.1', text: 'x'.repeat(5000) })
    expect((h.updated[0].content_text as string).length).toBe(4000)
  })
  it('an unsent message is kept and marked deleted', async () => {
    await applySocialDelete({ accountId: 'a', conversationId: 'conv-1', mid: 'mid.1' })
    expect(h.updated[0].deleted_at).toBeInstanceOf(Date)
  })
  it('an edit or unsend can never change a staff or bot reply', async () => {
    await applySocialEdit({ accountId: 'a', conversationId: 'conv-1', mid: 'mid.staff', text: 'pay to this account instead' })
    await applySocialDelete({ accountId: 'a', conversationId: 'conv-1', mid: 'mid.staff' })
    expect(h.updated).toEqual([])
  })
  it('nothing changes for an unknown or foreign message', async () => {
    await applySocialEdit({ accountId: 'a', conversationId: 'conv-9', mid: 'mid.1', text: 'hi' })
    await applySocialDelete({ accountId: 'a', conversationId: 'conv-1', mid: 'nope' })
    expect(h.updated).toEqual([])
  })
})

describe('echoes (replies typed in the Meta apps)', () => {
  it('a reply this CRM already saved is not added twice', async () => {
    const saved = await saveSocialEcho({ accountId: 'a', conversationId: 'conv-1', mid: 'mid.1', text: 'hi', mediaUrl: null, contentType: 'text', at: new Date() })
    expect(saved).toBe(false)
    expect(h.created).toEqual([])
  })
  it('a reply typed in the app is added as the team\'s message', async () => {
    const saved = await saveSocialEcho({ accountId: 'a', conversationId: 'conv-1', mid: 'mid.2', text: 'from phone', mediaUrl: null, contentType: 'text', at: new Date() })
    expect(saved).toBe(true)
    expect(h.created[0]).toMatchObject({ sender_type: 'agent', bot_source: 'native_app', message_id: 'mid.2', content_text: 'from phone' })
  })
})

describe('Business AI hand-over note', () => {
  it('names the reason in plain words', async () => {
    await noteBusinessAiHandoff({ accountId: 'a', conversationId: 'conv-1', reason: 'human_requested', adminText: null })
    expect(h.created[0]).toMatchObject({ sender_type: 'system' })
    expect(h.created[0].content_text).toContain('the customer asked for a person')
  })
})

describe('attachments', () => {
  it('every attachment is kept and typed; only https links are stored', () => {
    const rows = attachmentsToRows([
      { type: 'image', payload: { url: 'https://cdn/a.jpg' } },
      { type: 'image', payload: { url: 'http://insecure/b.jpg' } },
      { type: 'story_mention', payload: { url: 'https://cdn/s.mp4' } },
      { type: 'ig_reel', payload: {} },
    ])
    expect(rows.map((r) => r.contentType)).toEqual(['image', 'image', 'image', 'text'])
    expect(rows[1].url).toBeNull()
    expect(rows[2].label).toBe('[mentioned you in their story]')
    expect(rows[3].label).toBe('[shared a reel]')
  })
  it('no attachments: empty list, no crash', () => {
    expect(attachmentsToRows(undefined)).toEqual([])
  })
})
