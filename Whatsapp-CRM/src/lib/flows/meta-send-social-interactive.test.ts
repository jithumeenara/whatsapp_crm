import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sealSecret } from '@/lib/whatsapp/encryption'

/**
 * Chatbot choices on Instagram / Messenger:
 *  - A list node used to arrive as numbered plain text ("1. Fees") that
 *    the customer had to type back. Up to 13 options now go as tappable
 *    quick replies whose payload is the option id (the webhook already
 *    turns a quick-reply tap into the same reply a WhatsApp list gives).
 *  - A buttons node with a header picture used to drop the picture.
 *  - Everything sent is cut to Meta's limits, and only https links and
 *    pictures are ever sent.
 */

const h = vi.hoisted(() => ({
  channel: 'instagram' as string,
  calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
  saved: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({ NoWhatsAppConfigError: class extends Error {}, resolveWhatsAppConfig: async () => { throw new Error('no WhatsApp here') } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      const rows = sql.includes('facebook_config')
        ? [{ access_token: sealSecret('EAApage'), page_id: '1029384756' }]
        : sql.includes('instagram_config')
          ? [{ access_token: sealSecret('EAAsys'), instagram_account_id: '17841400000000', page_id: null }]
          : sql.includes('conversations') ? [{ channel: h.channel }] : []
      const p = Promise.resolve(rows)
      return { catch: () => p, then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => p.then(r, j) }
    },
    contact: { findFirst: async () => ({ id: 'c1', phone: 'x', facebook_id: '7654321', instagram_id: '998877' }) },
    message: { create: async (a: { data: Record<string, unknown> }) => { h.saved.push(a.data); return { id: 'msg' } } },
    conversation: { update: async () => ({}) },
  },
}))

import { engineSendInteractiveButtons, engineSendInteractiveList } from './meta-send'

const base = { accountId: 'acc', userId: 'u', conversationId: '00000000-0000-0000-0000-000000000001', contactId: 'c1' }
const sends = () => h.calls.filter((c) => c.body.message)
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `opt_${i + 1}`, title: `Option number ${i + 1} with a long name` }))

beforeEach(() => {
  h.calls = []
  h.saved = []
  h.channel = 'instagram'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    h.calls.push({ url: String(url), body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {} })
    return new Response(JSON.stringify({ message_id: 'm_1' }), { status: 200 })
  }))
})

describe('list node on Instagram / Messenger', () => {
  it('up to 13 options: tappable quick replies with the option id as payload, titles cut to 20', async () => {
    await engineSendInteractiveList({ ...base, bodyText: 'Which course?', buttonLabel: 'Pick', sections: [{ title: 'A', rows: rows(3) }] })
    expect(sends()).toHaveLength(1)
    const msg = sends()[0].body.message as { text: string; quick_replies: Array<{ content_type: string; title: string; payload: string }> }
    expect(msg.text).toBe('Which course?')
    expect(msg.quick_replies).toHaveLength(3)
    expect(msg.quick_replies[0]).toEqual({ content_type: 'text', title: 'Option number 1 with', payload: 'opt_1' })
    for (const q of msg.quick_replies) expect([...q.title].length).toBeLessThanOrEqual(20)
  })

  it('Messenger too', async () => {
    h.channel = 'facebook'
    await engineSendInteractiveList({ ...base, bodyText: 'Pick', buttonLabel: 'x', sections: [{ title: 'A', rows: rows(2) }] })
    expect(sends()[0].url.startsWith('https://graph.facebook.com/v27.0/1029384756/messages?')).toBe(true)
    expect((sends()[0].body.message as { quick_replies: unknown[] }).quick_replies).toHaveLength(2)
  })

  it('more than 13 options: the numbered text stays (Meta allows 13 quick replies)', async () => {
    await engineSendInteractiveList({ ...base, bodyText: 'Pick', buttonLabel: 'x', sections: [{ title: 'A', rows: rows(14) }] })
    const msg = sends()[0].body.message as { text: string; quick_replies?: unknown }
    expect(msg.quick_replies).toBeUndefined()
    expect(msg.text).toContain('14. Option number 14')
  })

  it('an option with an empty title or an over-long id is left out, never sent broken', async () => {
    await engineSendInteractiveList({ ...base, bodyText: 'Pick', buttonLabel: 'x', sections: [{ title: 'A', rows: [{ id: 'ok', title: 'Fine' }, { id: 'blank', title: '   ' }, { id: 'x'.repeat(1001), title: 'Too long id' }] }] })
    const msg = sends()[0].body.message as { quick_replies: Array<{ payload: string }> }
    expect(msg.quick_replies.map((q) => q.payload)).toEqual(['ok'])
  })
})

describe('buttons node with a header picture', () => {
  it('an https picture is sent first, then the buttons', async () => {
    await engineSendInteractiveButtons({ ...base, bodyText: 'Pick', headerMediaUrl: 'https://cdn.example.com/a.jpg', headerMediaType: 'image', buttons: [{ id: 'a', title: 'A' }] })
    expect(sends()).toHaveLength(2)
    expect(sends()[0].body.message).toEqual({ attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg', is_reusable: true } } })
    expect((sends()[1].body.message as { attachment: { payload: { template_type: string } } }).attachment.payload.template_type).toBe('button')
  })

  it('a non-https picture is never sent', async () => {
    await engineSendInteractiveButtons({ ...base, bodyText: 'Pick', headerMediaUrl: 'http://169.254.169.254/x.jpg', headerMediaType: 'image', buttons: [{ id: 'a', title: 'A' }] })
    expect(sends()).toHaveLength(1)
  })
})
