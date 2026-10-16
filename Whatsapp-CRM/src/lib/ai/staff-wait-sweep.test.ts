import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The assistant steps back in when a team member has not answered for an
 * hour — on the website chat too. It used to sweep WhatsApp only, so once
 * a colleague replied in a website chat and went quiet, the visitor's
 * next messages were never answered by anyone.
 */

const h = vi.hoisted(() => ({
  conversations: [] as Array<{ id: string; account_id: string; user_id: string; contact_id: string; channel: string }>,
  repliesToday: 0,
  dailyLimit: 300,
  replied: [] as Array<{ conversationId: string; channel: string }>,
  typing: [] as boolean[],
}))

const now = new Date('2026-10-16T15:00:00+05:30')
const customerAt = new Date('2026-10-16T13:50:00+05:30')

vi.mock('@/lib/db', () => ({
  prisma: {
    aiConfig: { findMany: () => Promise.resolve([{ account_id: 'acc' }]) },
    conversation: {
      findMany: (a: { where: { channel: string | { in: string[] } } }) => {
        const allowed = typeof a.where.channel === 'string' ? [a.where.channel] : a.where.channel.in
        return Promise.resolve(h.conversations.filter((c) => allowed.includes(c.channel)))
      },
    },
    message: {
      findFirst: () =>
        Promise.resolve({ id: `m-${Math.random()}`, sender_type: 'customer', created_at: customerAt, content_text: 'Any seats left?', transcript: null, message_id: null }),
      count: () => Promise.resolve(h.repliesToday),
    },
    webChatSession: { findFirst: () => Promise.resolve({ widget_id: 'w1' }) },
    webChatWidget: { findFirst: () => Promise.resolve({ daily_ai_limit: h.dailyLimit }) },
  },
}))

vi.mock('./auto-reply', () => ({
  STAFF_WAIT_MS: 60 * 60 * 1000,
  AI_AUTO_REPLY_SOURCE: 'ai_auto_reply',
  staffAwaitingReply: () => Promise.resolve({ at: new Date('2026-10-16T13:40:00+05:30') }),
  autoReplyToMessage: (a: { conversationId: string; channel: string }) => {
    h.replied.push({ conversationId: a.conversationId, channel: a.channel })
    return Promise.resolve('replied')
  },
}))

vi.mock('@/lib/webchat/realtime', () => ({
  pushVisitorTyping: (_: string, on: boolean) => h.typing.push(on),
  pushVisitorStatus: () => {},
}))

import { sweepStaffWaits } from './staff-wait-sweep'

const conv = (id: string, channel: string) => ({ id, account_id: 'acc', user_id: 'u', contact_id: 'k', channel })

describe('stepping in after a quiet team member', () => {
  beforeEach(() => {
    Object.assign(h, { conversations: [], repliesToday: 0, dailyLimit: 300, replied: [], typing: [] })
  })

  it('answers a website visitor on the website', async () => {
    h.conversations = [conv('web1', 'website')]
    expect(await sweepStaffWaits(now)).toBe(1)
    expect(h.replied).toEqual([{ conversationId: 'web1', channel: 'website' }])
    expect(h.typing).toEqual([true, false])
  })

  it('still answers WhatsApp as WhatsApp', async () => {
    h.conversations = [conv('wa1', 'whatsapp')]
    await sweepStaffWaits(now)
    expect(h.replied).toEqual([{ conversationId: 'wa1', channel: 'whatsapp' }])
  })

  it('keeps to the website chat\'s daily assistant limit', async () => {
    h.conversations = [conv('web2', 'website')]
    h.repliesToday = 300
    expect(await sweepStaffWaits(now)).toBe(0)
    expect(h.replied).toEqual([])
  })
})
