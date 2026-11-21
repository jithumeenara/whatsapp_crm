import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Private reply to a comment: Meta allows one per comment within 7 days.
 * Claimed atomically before sending (double click / two people = one DM),
 * released if Meta refuses, only this workspace's comment, agent+ only,
 * plain words on failure.
 */

const ID = '11111111-2222-4333-8444-555555555555'
const h = vi.hoisted(() => ({
  role: 'agent' as string,
  minAsked: [] as string[],
  row: null as Record<string, unknown> | null,
  claims: 0,
  claimResult: 1,
  released: 0,
  sends: [] as Array<{ url: string; body: unknown }>,
  metaFails: false,
  inbox: 0,
}))

vi.mock('@/lib/auth/account', () => ({
  requirePageAccess: async (_page: string, min: string) => {
    h.minAsked.push(min)
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc-1', userId: '99999999-2222-4333-8444-555555555555', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }), RATE_LIMITS: { send: {} } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string | null) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      if (sql.includes('FROM social_comments WHERE id')) return h.row && values.includes('acc-1') ? [h.row] : []
      if (sql.includes('FROM instagram_config')) return [{ access_token: 'EAAsys', instagram_account_id: '17841400000000', page_id: null }]
      return []
    },
    $executeRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('private_reply_at = now()')) { h.claims++; return h.claimResult }
      if (sql.includes('private_reply_at = NULL')) { h.released++; return 1 }
      return 1
    },
    profile: { findFirst: async () => ({ user_id: 'owner' }) },
    contact: { findFirst: async () => null, create: async () => { h.inbox++; return { id: 'contact-1' } } },
    conversation: { findFirst: async () => null, create: async () => ({ id: 'conv-1' }), update: async () => ({}) },
    message: { create: async () => ({ id: 'm1' }) },
  },
}))

import { POST } from './route'

const call = (text: unknown = 'Sent you the fee details') =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ text }) }), { params: Promise.resolve({ id: ID }) })

beforeEach(() => {
  h.role = 'agent'; h.minAsked = []; h.claims = 0; h.claimResult = 1; h.released = 0; h.sends = []; h.metaFails = false; h.inbox = 0
  h.row = { id: ID, channel: 'instagram', comment_id: '17895695668004550', from_id: '998877', from_name: 'meera', commented_at: new Date(), private_reply_at: null, deleted_at: null, is_hidden: false }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    h.sends.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return h.metaFails
      ? new Response(JSON.stringify({ error: { code: 10, error_subcode: 2018108, message: 'raw meta words fbtrace_id=Q' } }), { status: 400 })
      : new Response(JSON.stringify({ recipient_id: '998877', message_id: 'aWdfZAG1' }), { status: 200 })
  }))
})

describe('private reply to a comment', () => {
  it('sends one DM addressed to the comment and puts it in the Inbox', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.minAsked).toEqual(['agent'])
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].url.startsWith('https://graph.facebook.com/v27.0/17841400000000/messages?')).toBe(true)
    expect(h.sends[0].body).toEqual({ recipient: { comment_id: '17895695668004550' }, message: { text: 'Sent you the fee details' } })
    expect(h.inbox).toBe(1)
    expect((await res.json()).conversation_id).toBe('conv-1')
  })

  it('a second click (claim already taken) sends nothing', async () => {
    h.claimResult = 0
    const res = await call()
    expect(res.status).toBe(409)
    expect(h.sends).toHaveLength(0)
  })

  it('Meta refuses: the claim is released and the user gets plain words', async () => {
    h.metaFails = true
    const res = await call()
    expect(res.status).toBe(502)
    expect(h.released).toBe(1)
    expect((await res.json()).error).not.toContain('fbtrace')
  })

  it('already replied, or older than 7 days: refused before anything is sent', async () => {
    h.row = { ...h.row, private_reply_at: new Date() }
    expect((await call()).status).toBe(409)
    h.row = { ...h.row, private_reply_at: null, commented_at: new Date(Date.now() - 8 * 86_400_000) }
    expect((await call()).status).toBe(409)
    expect(h.claims + h.sends.length).toBe(0)
  })

  it("another workspace's comment is not found", async () => {
    h.row = null
    expect((await call()).status).toBe(404)
    expect(h.sends).toHaveLength(0)
  })

  it('a viewer cannot send; bad text is refused', async () => {
    h.role = 'viewer'
    expect((await call()).status).toBe(403)
    h.role = 'agent'
    expect((await call({ $gt: '' })).status).toBe(400)
    expect((await call('x'.repeat(1001))).status).toBe(400)
    expect(h.sends).toHaveLength(0)
  })
})
