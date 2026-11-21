import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Comments screen: hide and delete are supervisor+ (an agent may reply and
 * mark done, not remove customers' words); the list is the caller's own
 * workspace only and never carries a token; links are Instagram/Facebook only.
 */

const ID = '11111111-2222-4333-8444-555555555555'
const h = vi.hoisted(() => ({
  role: 'agent' as string,
  listRows: [] as Array<Record<string, unknown>>,
  listAccount: '' as unknown,
  calls: [] as Array<{ url: string; method: string; body: string }>,
  updates: [] as string[],
}))

vi.mock('@/lib/auth/account', () => ({
  requirePageAccess: async (_page: string, min: string) => {
    const rank = ['viewer', 'agent', 'supervisor', 'admin', 'owner']
    if (rank.indexOf(h.role) < rank.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc-1', userId: 'u-1', role: h.role }
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
      if (sql.includes('FROM social_comments WHERE id')) return [{ id: ID, channel: 'facebook', comment_id: '123_456', from_id: '1', from_name: 'A', commented_at: new Date(), private_reply_at: null, deleted_at: null, is_hidden: false }]
      if (sql.includes('FROM facebook_config')) return [{ access_token: 'EAApage', instagram_account_id: null, page_id: '1029' }]
      if (sql.includes('FROM social_comments')) { h.listAccount = values[0]; return h.listRows }
      return []
    },
    $executeRaw: async (strings: TemplateStringsArray) => { h.updates.push(strings.join('?')); return 1 },
  },
}))

import { GET } from './route'
import { DELETE, PATCH } from './[id]/route'
import { POST as HIDE } from './[id]/hide/route'

const params = { params: Promise.resolve({ id: ID }) }

beforeEach(() => {
  h.role = 'agent'; h.calls = []; h.updates = []; h.listRows = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    h.calls.push({ url: String(url), method: init.method ?? 'GET', body: String(init.body ?? '') })
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }))
})

describe('moderation needs a supervisor', () => {
  it('an agent cannot hide or delete; nothing reaches Meta', async () => {
    expect((await HIDE(new Request('http://x', { method: 'POST', body: JSON.stringify({ hidden: true }) }), params)).status).toBe(403)
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }), params)).status).toBe(403)
    expect(h.calls).toEqual([])
  })
  it('a supervisor hides on the Page (is_hidden) and deletes; the row is kept, marked deleted', async () => {
    h.role = 'supervisor'
    expect((await HIDE(new Request('http://x', { method: 'POST', body: JSON.stringify({ hidden: true }) }), params)).status).toBe(200)
    expect(h.calls[0]).toMatchObject({ method: 'POST', body: 'is_hidden=true' })
    expect(h.calls[0].url.startsWith('https://graph.facebook.com/v27.0/123_456?')).toBe(true)
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }), params)).status).toBe(200)
    expect(h.calls[1]).toMatchObject({ method: 'DELETE' })
    expect(h.updates.join()).toContain('deleted_at = now()')
    expect(h.updates.join()).not.toMatch(/DELETE FROM/i)
  })
  it('hidden must be true or false', async () => {
    h.role = 'owner'
    expect((await HIDE(new Request('http://x', { method: 'POST', body: JSON.stringify({ hidden: 'yes' }) }), params)).status).toBe(400)
  })
  it('an agent may mark done; any other status is refused', async () => {
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }), params)).status).toBe(200)
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ status: "done'; --" }) }), params)).status).toBe(400)
  })
})

describe('the list', () => {
  it("only the caller's workspace; no token; only Instagram/Facebook links", async () => {
    h.role = 'viewer'
    h.listRows = [{ id: ID, channel: 'instagram', parent_id: null, post_caption: 'Admissions open', post_permalink: 'javascript:alert(1)', from_name: 'meera', contact_id: null, text: '<img src=x onerror=alert(1)>', commented_at: new Date(), is_hidden: false, deleted_at: null, status: 'open', private_reply_at: null, replies: 'junk' }]
    const res = await GET(new Request('http://x/api/social/comments?status=open'))
    expect(res.status).toBe(200)
    expect(h.listAccount).toBe('acc-1')
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/EAA|access_token/)
    expect(body.comments[0].post_link).toBeNull()
    expect(body.comments[0].replies).toEqual([])
    expect(body.comments[0].can_private_reply).toBe(true)
  })
})
