import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reacting from the Inbox. An Instagram / Messenger chat must react through
 * that channel's Send API — it used to go out over WhatsApp to the contact's
 * phone. Only one emoji is accepted, and Meta's raw errors stay in the log.
 */

const h = vi.hoisted(() => ({
  channel: 'instagram' as string,
  waSent: 0,
  social: [] as Array<Record<string, unknown>>,
  saved: [] as string[],
  waError: null as Error | null,
}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => new Response(null, { status: 429 }), RATE_LIMITS: { react: {} } }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendReactionMessage: async () => { h.waSent++; if (h.waError) throw h.waError } }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({
  resolveWhatsAppConfig: async () => ({ access_token: 't', phone_number_id: 'p' }),
  NoWhatsAppConfigError: class extends Error {},
}))
vi.mock('@/lib/meta/social-messaging', () => ({
  loadSocialTarget: async (_a: string, _c: string, channel: string) => ({ channel, recipientId: 'IGSID-9', token: 'x', url: 'u' }),
  socialPost: async (_t: unknown, body: Record<string, unknown>) => { h.social.push(body); return { messageId: null } },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: async () => ({ account_id: 'acc-1', account_role: 'admin' }) },
    message: { findUnique: async () => ({ id: 'row-1', message_id: 'mid.1', conversation_id: 'conv-1' }) },
    conversation: { findFirst: async () => ({ id: 'conv-1', account_id: 'acc-1', channel: h.channel, contact_id: 'c-1', contact: { phone: '+919000000000' } }) },
    messageReaction: {
      upsert: async () => { h.saved.push('upsert') },
      deleteMany: async () => { h.saved.push('delete') },
    },
  },
}))

import { POST } from './route'

const call = (emoji: string) => POST(new Request('http://x/api/whatsapp/react', { method: 'POST', body: JSON.stringify({ message_id: 'row-1', emoji }) }))

beforeEach(() => { h.channel = 'instagram'; h.waSent = 0; h.social = []; h.saved = []; h.waError = null })

describe('reactions on Instagram and Messenger', () => {
  it('an Instagram heart goes through Instagram, never WhatsApp', async () => {
    const res = await call('❤️')
    expect(res.status).toBe(200)
    expect(h.waSent).toBe(0)
    expect(h.social[0]).toEqual({ recipient: { id: 'IGSID-9' }, sender_action: 'react', payload: { message_id: 'mid.1', reaction: 'love' } })
    expect(h.saved).toEqual(['upsert'])
  })
  it('Instagram refuses other emoji with a clear message', async () => {
    const res = await call('👍')
    expect(res.status).toBe(400)
    expect(h.social).toEqual([])
  })
  it('Messenger takes the emoji; removing sends unreact', async () => {
    h.channel = 'facebook'
    await call('👍')
    await call('')
    expect(h.social[0]).toMatchObject({ sender_action: 'react', payload: { reaction: '👍' } })
    expect(h.social[1]).toMatchObject({ sender_action: 'unreact', payload: { message_id: 'mid.1' } })
    expect(h.waSent).toBe(0)
  })
  it('a channel without reactions is refused, nothing sent', async () => {
    h.channel = 'email'
    const res = await call('👍')
    expect(res.status).toBe(400)
    expect(h.waSent + h.social.length).toBe(0)
  })
})

describe('input and errors', () => {
  it('text instead of an emoji is refused', async () => {
    h.channel = 'whatsapp'
    expect((await call('hello')).status).toBe(400)
    expect((await call('<script>')).status).toBe(400)
    expect(h.waSent).toBe(0)
  })
  it('a WhatsApp failure answers in plain words, not the raw Meta error', async () => {
    h.channel = 'whatsapp'
    h.waError = new Error('(#131009) Parameter value is not valid fbtrace_id=Abc')
    const res = await call('👍')
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).not.toContain('fbtrace')
  })
})
