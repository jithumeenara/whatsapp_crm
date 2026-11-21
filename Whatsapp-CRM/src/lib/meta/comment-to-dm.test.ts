import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Comment-to-DM: an automation's "send message" on a comment trigger is a
 * private reply to that comment. It must not become a way to flood someone
 * (one automatic reply per person per day), must keep Meta's one-per-comment
 * rule (atomic claim), and is switched on only once comments can arrive.
 */

const ID = '11111111-2222-4333-8444-555555555555'
const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  repliedToday: false,
  claim: 1,
  released: 0,
  sends: 0,
  seenComment: false,
  perms: [] as unknown[],
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string | null) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('FROM social_comments WHERE id')) return h.row ? [h.row] : []
      if (sql.includes("private_reply_at > now() - interval '1 day'")) return h.repliedToday ? [{ n: 1 }] : []
      if (sql.includes('FROM social_comments WHERE account_id') && sql.includes('LIMIT 1') && !sql.includes('from_id')) return h.seenComment ? [{ n: 1 }] : []
      if (sql.includes('granted_permissions')) return h.perms.map((p) => ({ p }))
      if (sql.includes('FROM facebook_config')) return [{ access_token: 'EAApage', instagram_account_id: null, page_id: '1029' }]
      return []
    },
    $executeRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('private_reply_at = now()')) return h.claim
      if (sql.includes('private_reply_at = NULL')) { h.released++; return 1 }
      return 1
    },
    profile: { findFirst: async () => ({ user_id: 'owner' }) },
    contact: { findFirst: async () => null, create: async () => ({ id: 'contact-9' }) },
    conversation: { findFirst: async () => null, create: async () => ({ id: 'conv-9' }), update: async () => ({}) },
    message: { create: async () => ({ id: 'm' }) },
  },
}))

import { automatedPrivateReply, commentsReady } from './social-comments'

const run = (text = 'Here are the details') => automatedPrivateReply({ accountId: 'acc', socialCommentId: ID, text, userId: '99999999-2222-4333-8444-555555555555' })

beforeEach(() => {
  h.row = { id: ID, channel: 'facebook', comment_id: '77_1001', from_id: '4455', from_name: 'Asha', commented_at: new Date(), private_reply_at: null, deleted_at: null, is_hidden: false }
  h.repliedToday = false; h.claim = 1; h.released = 0; h.sends = 0; h.seenComment = false; h.perms = []
  vi.stubGlobal('fetch', vi.fn(async () => { h.sends++; return new Response(JSON.stringify({ recipient_id: '24680', message_id: 'm_1' }), { status: 200 }) }))
})

describe('automatic private reply to a comment', () => {
  it('sends once and returns the new contact for the next steps', async () => {
    expect(await run()).toEqual({ ok: true, contactId: 'contact-9' })
    expect(h.sends).toBe(1)
  })
  it('the same person already got an automatic reply today: nothing sent', async () => {
    h.repliedToday = true
    expect((await run()).ok).toBe(false)
    expect(h.sends).toBe(0)
  })
  it('the claim was taken (resend, second automation): nothing sent', async () => {
    h.claim = 0
    expect((await run()).ok).toBe(false)
    expect(h.sends).toBe(0)
  })
  it('empty text after interpolation: nothing sent', async () => {
    expect((await run('   ')).ok).toBe(false)
    expect(h.sends).toBe(0)
  })
  it("another workspace's comment id: nothing sent", async () => {
    h.row = null
    expect((await run()).ok).toBe(false)
    expect(h.sends).toBe(0)
  })
})

describe('switching comment automations on', () => {
  it('only once Meta has delivered a comment or the permission is granted', async () => {
    expect(await commentsReady('acc')).toBe(false)
    h.perms = [['pages_messaging', 'pages_manage_engagement']]
    expect(await commentsReady('acc')).toBe(true)
    h.perms = [['pages_messaging']]
    h.seenComment = true
    expect(await commentsReady('acc')).toBe(true)
  })
})
