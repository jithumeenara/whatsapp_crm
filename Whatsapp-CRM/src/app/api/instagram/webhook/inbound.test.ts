import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Instagram inbound (POST /api/instagram/webhook):
 *  - Bug: a resend from Meta was saved and answered twice (no unique index
 *    behind the "duplicate" catch).
 *  - Bug: mark_seen and the sender's name were always asked of
 *    graph.instagram.com, where an EAA token (Embedded Signup, System User,
 *    Unified Login) never works.
 *  - Bug: payload timestamps in seconds were stored as 1970 dates.
 */

const h = vi.hoisted(() => ({
  comments: [] as unknown[][],
  token: 'EAAsystem',
  saved: [] as Array<Record<string, unknown>>,
  flows: 0,
  fetches: [] as string[],
  automations: [] as string[],
}))

vi.mock('@/lib/social/webhook-secrets', () => ({ socialWebhookScope: async () => ({ all: true }), scopeAllows: () => true, sameToken: () => false }))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/audit/actors', () => ({ webhookRejected: () => {} }))
vi.mock('@/lib/ads/attribution', () => ({ recordAdTouch: async () => {}, referralFromMeta: () => null }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: async () => { h.flows++; return { consumed: true, outcome: 'matched' } } }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: async (a: { triggerType: string }) => { h.automations.push(a.triggerType) } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string | null) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: () => ({ catch: () => Promise.resolve() }),
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (sql.includes('INSERT INTO social_comments')) { const created = !h.comments.some((v) => v[2] === values[2]); h.comments.push(values); return [{ id: 'sc-1', created }] }
      if (sql.includes('social_comments')) return []
      return [{ account_id: 'acc-1', access_token: h.token, verify_token: 'v', instagram_account_id: '17841400000000', page_id: '1029' }]
    },
    profile: { findFirst: async () => ({ user_id: 'owner' }) },
    contact: { findFirst: async () => null, create: async () => ({ id: 'c1' }), update: async () => ({}) },
    conversation: { findFirst: async () => ({ id: 'conv-1' }), update: async () => ({ id: 'conv-1' }), create: async () => ({ id: 'conv-1' }) },
    message: {
      findFirst: async (a: { where: { message_id: string } }) => h.saved.find((m) => m.message_id === a.where.message_id) ?? null,
      create: async (a: { data: Record<string, unknown> }) => { const row = { id: `m${h.saved.length + 1}`, ...a.data }; h.saved.push(row); return row },
      count: async () => h.saved.length,
    },
  },
}))

import { POST } from './route'

const event = (mid: string, timestamp: number) => ({
  object: 'instagram',
  entry: [{ id: '17841400000000', changes: [{ field: 'messages', value: { sender: { id: '998877' }, recipient: { id: '17841400000000' }, timestamp, message: { mid, text: 'hi' } } }] }],
})
const post = (body: unknown) => POST(new NextRequest('http://x/api/instagram/webhook', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.comments = []
  h.saved = []
  h.flows = 0
  h.fetches = []
  h.automations = []
  h.token = 'EAAsystem'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { h.fetches.push(String(url)); return new Response('{"name":"Meera"}', { status: 200 }) }))
})

describe('Instagram inbound', () => {
  it('the same message delivered twice is saved and answered once', async () => {
    await post(event('mid.1', 1763290000))
    await vi.waitFor(() => expect(h.flows).toBe(1))
    await post(event('mid.1', 1763290000))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.saved).toHaveLength(1)
    expect(h.flows).toBe(1)
  })

  it('a timestamp in seconds is stored as the real date, not 1970', async () => {
    await post(event('mid.2', 1763290000))
    await vi.waitFor(() => expect(h.saved).toHaveLength(1))
    expect((h.saved[0].created_at as Date).getUTCFullYear()).toBe(2025)
  })

  it('with an EAA token, mark-seen and the name lookup use graph.facebook.com', async () => {
    await post(event('mid.3', 1763290000000))
    await vi.waitFor(() => expect(h.flows).toBe(1))
    expect(h.fetches.length).toBeGreaterThan(0)
    for (const u of h.fetches) expect(u.startsWith('https://graph.facebook.com/')).toBe(true)
    expect(h.fetches.some((u) => u.includes('/17841400000000/messages'))).toBe(true)
  })

  it('with an Instagram Login token they stay on graph.instagram.com', async () => {
    h.token = 'IGAAlogin'
    await post(event('mid.4', 1763290000000))
    await vi.waitFor(() => expect(h.flows).toBe(1))
    for (const u of h.fetches) expect(u.startsWith('https://graph.instagram.com/')).toBe(true)
  })

  it('a reply to an earlier message is linked to it; an unknown message id links to nothing', async () => {
    await post(event('mid.10', 1763290000))
    await vi.waitFor(() => expect(h.saved).toHaveLength(1))
    const reply = (mid: string, to: string) => ({
      object: 'instagram',
      entry: [{ id: '17841400000000', changes: [{ field: 'messages', value: { sender: { id: '998877' }, recipient: { id: '17841400000000' }, timestamp: 1763290100, message: { mid, text: 'yes this', reply_to: { mid: to } } } }] }],
    })
    await post(reply('mid.11', 'mid.10'))
    await vi.waitFor(() => expect(h.saved).toHaveLength(2))
    expect(h.saved[1].reply_to_message_id).toBe('m1')
    await post(reply('mid.12', 'mid.not-here'))
    await vi.waitFor(() => expect(h.saved).toHaveLength(3))
    expect(h.saved[2].reply_to_message_id ?? null).toBeNull()
  })

  it("the business's own comment reply is not treated as a customer (no automation answers itself)", async () => {
    const comment = (fromId: string) => ({ object: 'instagram', entry: [{ id: '17841400000000', changes: [{ field: 'comments', value: { id: `1789000${fromId}`, text: 'price?', from: { id: fromId }, media: { id: 'media1' } } }] }] })
    await post(comment('17841400000000'))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.automations).toEqual([])
    await post(comment('555444'))
    await vi.waitFor(() => expect(h.automations).toEqual(['comment_keyword_match']))
  })

  it("a customer comment is kept for the Comments screen; the account's own and a forged id are not", async () => {
    const comment = (id: string, fromId: string) => ({ object: 'instagram', entry: [{ id: '17841400000000', changes: [{ field: 'comments', value: { id, text: 'fees?', from: { id: fromId, username: 'meera' }, media: { id: '1790000001' } } }] }] })
    await post(comment('17895695668004550', '555444'))
    await vi.waitFor(() => expect(h.comments).toHaveLength(1))
    expect(h.comments[0]).toEqual(expect.arrayContaining(['acc-1', 'instagram', '17895695668004550', '1790000001', '555444', 'meera', 'fees?']))
    await post(comment('17895695668004551', '17841400000000'))
    await post(comment('1/../../me', '555444'))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.comments).toHaveLength(1)
  })

  it('Meta resending the same comment runs the comment automation once', async () => {
    const comment = { object: 'instagram', entry: [{ id: '17841400000000', changes: [{ field: 'comments', value: { id: '17895695668009999', text: 'PRICE', from: { id: '555444', username: 'meera' }, media: { id: '1790000001' } } }] }] }
    await post(comment)
    await vi.waitFor(() => expect(h.automations).toHaveLength(1))
    await post(comment)
    await vi.waitFor(() => expect(h.comments).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.automations).toHaveLength(1)
  })
})
