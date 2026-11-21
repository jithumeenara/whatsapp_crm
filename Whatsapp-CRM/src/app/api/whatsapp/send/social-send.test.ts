import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * An agent's reply on Messenger / Instagram (POST /api/whatsapp/send):
 *  - Bug: nothing on the server checked Meta's 24-hour window, so a late
 *    reply went to Meta and failed with a raw error (and API-key sends were
 *    never stopped).
 *  - Bug: the recipient was contact.phone, not the PSID/IGSID kept on the
 *    contact; an Instagram EAA token went to graph.instagram.com.
 *  - A person may reply up to 7 days with the HUMAN_AGENT tag once Meta has
 *    approved the Human Agent feature for the app (a per-channel setting).
 */

const HOUR = 3_600_000
const h = vi.hoisted(() => ({
  channel: 'facebook' as 'facebook' | 'instagram',
  lastInbound: null as Date | null,
  humanAgent: false,
  calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
  saved: [] as Array<Record<string, unknown>>,
  template: null as Record<string, unknown> | null,
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'agent-1' } }) }))
vi.mock('@/lib/auth/api-key', () => ({ verifyApiKey: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }), RATE_LIMITS: { send: {} } }))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/leads/first-response', () => ({ stampFirstResponse: async () => {} }))
vi.mock('@/lib/whatsapp/encryption', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/encryption')>('@/lib/whatsapp/encryption')
  return { ...actual, openStoredSecret: (v: string | null) => v }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'acc', account_role: 'agent' }) },
    conversation: {
      findFirst: async ({ where }: { where: { id: string; account_id: string } }) =>
        where.account_id === 'acc' && where.id === 'c1'
          ? { id: 'c1', contact_id: 'contact-1', channel: h.channel, assigned_agent_id: 'agent-1', contact: { id: 'contact-1', phone: '+919847012345' } }
          : null,
      update: async () => ({ id: 'c1' }),
    },
    contact: { findFirst: async () => ({ phone: '+919847012345', facebook_id: '7654321', instagram_id: '998877' }) },
    message: {
      findFirst: async () => (h.lastInbound ? { created_at: h.lastInbound } : null),
      create: async (a: { data: Record<string, unknown> }) => { h.saved.push(a.data); return { id: 'm1', ...a.data } },
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('FROM messenger_templates')) return h.template ? [h.template] : []
      if (sql.includes('human_agent_enabled')) return [{ human_agent_enabled: h.humanAgent }]
      if (sql.includes('facebook_config')) return [{ access_token: 'EAApage', page_id: '1029' }]
      if (sql.includes('instagram_config')) return [{ access_token: 'EAAsystem', instagram_account_id: '17841400000000', page_id: null }]
      return []
    },
  },
}))

import { POST } from './route'

const send = (text = 'Hello') =>
  POST(new NextRequest('http://x/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ conversation_id: 'c1', message_type: 'text', content_text: text }) }))

beforeEach(() => {
  h.channel = 'facebook'
  h.lastInbound = new Date(Date.now() - 2 * HOUR)
  h.humanAgent = false
  h.calls = []
  h.saved = []
  h.template = null
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    h.calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} })
    return new Response(JSON.stringify({ message_id: 'm_meta_1' }), { status: 200 })
  }))
})

describe('agent reply on Messenger / Instagram', () => {
  it('inside 24 hours: sent to the Page, to the PSID kept on the contact', async () => {
    const res = await send()
    expect(res.status).toBe(200)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url.startsWith('https://graph.facebook.com/v27.0/1029/messages?')).toBe(true)
    expect(h.calls[0].body.recipient).toEqual({ id: '7654321' })
    expect(h.calls[0].body.messaging_type).toBe('RESPONSE')
    expect(h.saved[0]).toMatchObject({ sender_type: 'agent', message_id: 'm_meta_1' })
  })

  it('after 24 hours: refused with a plain reason, nothing sent', async () => {
    h.lastInbound = new Date(Date.now() - 30 * HOUR)
    const res = await send()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/24 hours/)
    expect(h.calls).toHaveLength(0)
  })

  it('after 24 hours with Human Agent on: sent with the HUMAN_AGENT tag (up to 7 days)', async () => {
    h.lastInbound = new Date(Date.now() - 30 * HOUR)
    h.humanAgent = true
    expect((await send()).status).toBe(200)
    expect(h.calls[0].body).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
  })

  it('Instagram with an EAA token goes to graph.facebook.com with the account id', async () => {
    h.channel = 'instagram'
    expect((await send()).status).toBe(200)
    expect(h.calls[0].url.startsWith('https://graph.facebook.com/v27.0/17841400000000/messages?')).toBe(true)
    expect(h.calls[0].body.recipient).toEqual({ id: '998877' })
  })
})

describe('what an agent may send on Messenger / Instagram', () => {
  const post = (body: Record<string, unknown>) =>
    POST(new NextRequest('http://x/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ conversation_id: 'c1', ...body }) }))

  it('text that is not text is refused, nothing sent or saved', async () => {
    const res = await post({ message_type: 'text', content_text: { attachment: { type: 'template' } } })
    expect(res.status).toBe(400)
    expect(h.calls).toHaveLength(0)
    expect(h.saved).toHaveLength(0)
  })

  it('text longer than Meta allows is refused with the limit', async () => {
    h.channel = 'instagram'
    const res = await post({ message_type: 'text', content_text: 'x'.repeat(1001) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/1000/)
    expect(h.calls).toHaveLength(0)
  })

  it('an unknown message type is refused, not stored as a content type', async () => {
    const res = await post({ message_type: '<img onerror=x>', content_text: 'hi' })
    expect(res.status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })
})

describe('Messenger utility template (after the 24 hours)', () => {
  const tpl = (over: Record<string, unknown> = {}) =>
    POST(new NextRequest('http://x/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ conversation_id: 'c1', message_type: 'messenger_template', messenger_template_id: '11111111-2222-4333-8444-555555555555', template_params: ['Asha'], ...over }) }))

  it('outside the window: sent as UTILITY with the template and its blank', async () => {
    h.lastInbound = new Date(Date.now() - 30 * HOUR)
    h.template = { name: 'order_update', language: 'en_US', body: 'Hi {{1}}, your order shipped.', param_count: 1, status: 'approved' }
    const res = await tpl()
    expect(res.status).toBe(200)
    expect(h.calls[0].url.startsWith('https://graph.facebook.com/v27.0/1029/messages?')).toBe(true)
    expect(h.calls[0].body).toMatchObject({ recipient: { id: '7654321' }, messaging_type: 'UTILITY', message: { attachment: { type: 'template', payload: { template_type: 'utility', name: 'order_update' } } } })
    expect(h.saved[0]).toMatchObject({ content_type: 'template', content_text: 'Hi Asha, your order shipped.' })
  })
  it('not approved, missing blanks, or not this workspace: nothing sent', async () => {
    h.template = { name: 'x', language: 'en_US', body: 'Hi {{1}} ok', param_count: 1, status: 'pending' }
    expect((await tpl()).status).toBe(409)
    h.template = { name: 'x', language: 'en_US', body: 'Hi {{1}} ok', param_count: 1, status: 'approved' }
    expect((await tpl({ template_params: [] })).status).toBe(400)
    h.template = null
    expect((await tpl()).status).toBe(404)
    expect((await tpl({ messenger_template_id: "x' OR 1=1" })).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })
})
