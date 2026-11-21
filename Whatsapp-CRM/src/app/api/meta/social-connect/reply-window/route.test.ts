import { describe, expect, it, vi } from 'vitest'

// The Inbox composer asks how long it may let staff reply on Instagram /
// Messenger: 24 h, or 7 days with Human agent replies on. One number only.

const h = vi.hoisted(() => ({ human: false, asked: [] as string[] }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'acc-1', role: 'viewer' }),
  toErrorResponse: () => new Response(null, { status: 500 }),
}))
vi.mock('@/lib/meta/social-messaging', () => ({
  humanAgentEnabled: async (accountId: string, channel: string) => { h.asked.push(`${accountId}:${channel}`); return h.human },
}))

import { GET } from './route'

const get = (q: string) => GET(new Request(`http://x/api/meta/social-connect/reply-window${q}`))

describe('reply window', () => {
  it('24 hours normally, 7 days with Human agent on, for the caller\'s own workspace', async () => {
    expect(await (await get('?channel=instagram')).json()).toEqual({ hours: 24 })
    h.human = true
    expect(await (await get('?channel=facebook')).json()).toEqual({ hours: 168 })
    expect(h.asked).toEqual(['acc-1:instagram', 'acc-1:facebook'])
  })
  it('an unknown channel is refused', async () => {
    expect((await get('?channel=whatsapp')).status).toBe(400)
    expect((await get('')).status).toBe(400)
  })
})
