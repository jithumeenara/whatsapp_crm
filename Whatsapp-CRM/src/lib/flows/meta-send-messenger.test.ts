import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sealSecret } from '@/lib/whatsapp/encryption'

/**
 * Bug: chatbot, AI and automation replies in a Messenger (Facebook Page)
 * conversation had no Messenger branch in meta-send.ts. They fell into the
 * WhatsApp path, which refused the PSID as an invalid phone number — or,
 * for a short PSID, sent a WhatsApp message to it. Every bot reply on
 * Messenger failed.
 *
 * Also: an Instagram EAA token (Embedded Signup / System User / Unified
 * Login) was sent to graph.instagram.com, where it can never work.
 */

const h = vi.hoisted(() => ({
  channel: 'facebook' as string,
  igToken: '',
  fbToken: '',
  calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
  waSends: 0,
}))

vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({
  NoWhatsAppConfigError: class extends Error {},
  resolveWhatsAppConfig: async () => ({ phone_number_id: 'pn', access_token: sealSecret('wa-token') }),
}))
vi.mock('@/lib/whatsapp/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/meta-api')>('@/lib/whatsapp/meta-api')
  return { ...actual, sendTextMessage: vi.fn(async () => { h.waSends++; return { messageId: 'wamid.x' } }) }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      const rows = sql.includes('facebook_config')
        ? [{ access_token: h.fbToken, page_id: '1029384756' }]
        : sql.includes('instagram_config')
          ? [{ access_token: h.igToken, instagram_account_id: '17841400000000', page_id: '1029384756' }]
          : sql.includes('conversations')
            ? [{ channel: h.channel }]
            : []
      const p = Promise.resolve(rows)
      return { catch: () => p, then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => p.then(r, j) }
    },
    contact: { findFirst: async () => ({ id: 'c1', phone: '7654321098765432', facebook_id: '7654321098765432', instagram_id: '998877665544' }) },
    message: { create: async () => ({ id: 'msg' }) },
    conversation: { update: async () => ({}) },
  },
}))

import { engineSendInteractiveButtons, engineSendMedia, engineSendText } from './meta-send'

const base = { accountId: 'acc-a', userId: 'u', conversationId: '00000000-0000-0000-0000-000000000001', contactId: 'c1' }

beforeEach(() => {
  h.calls = []
  h.waSends = 0
  h.fbToken = sealSecret('EAApage-token')!
  h.igToken = sealSecret('EAAsystem-user-token')!
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    h.calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} })
    return new Response(JSON.stringify({ message_id: 'm_123', recipient_id: 'r' }), { status: 200 })
  }))
})

const sends = () => h.calls.filter((c) => c.body.message)

describe('Messenger bot replies', () => {
  it('a text reply goes to the Page on graph.facebook.com, to the PSID, never to WhatsApp', async () => {
    h.channel = 'facebook'
    await engineSendText({ ...base, text: 'Hello *there*' })
    expect(h.waSends).toBe(0)
    expect(sends()).toHaveLength(1)
    const { url, body } = sends()[0]
    expect(url.startsWith('https://graph.facebook.com/v21.0/1029384756/messages?')).toBe(true)
    expect(new URL(url).searchParams.get('access_token')).toBe('EAApage-token')
    expect(body.recipient).toEqual({ id: '7654321098765432' })
    expect(body.messaging_type).toBe('RESPONSE')
  })

  it('media and buttons go to Messenger too', async () => {
    h.channel = 'facebook'
    await engineSendMedia({ ...base, kind: 'image', link: 'https://example.com/a.jpg' })
    await engineSendInteractiveButtons({ ...base, body: 'Pick one', buttons: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] })
    expect(h.waSends).toBe(0)
    expect(sends()).toHaveLength(2)
    for (const c of sends()) expect(c.url.startsWith('https://graph.facebook.com/v21.0/1029384756/messages?')).toBe(true)
  })
})

describe('Instagram with an EAA token', () => {
  it('goes to graph.facebook.com with the Instagram account id', async () => {
    h.channel = 'instagram'
    await engineSendText({ ...base, text: 'hi' })
    expect(sends()).toHaveLength(1)
    expect(sends()[0].url.startsWith('https://graph.facebook.com/v21.0/17841400000000/messages?')).toBe(true)
    expect(sends()[0].body.recipient).toEqual({ id: '998877665544' })
  })
})
