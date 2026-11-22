import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Webhook subscription after a one-click connect. Meta refuses the WHOLE
 * subscription when one field lacks its permission ("(#200) Requires
 * instagram_manage_insights permission", seen live 2026-11-22): then not even
 * messages reached the Inbox. Fields now follow the granted permissions, and
 * a refusal falls back to messages only.
 */

const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; url: URL }>,
  refuse: [] as Array<{ code: number; message: string } | null>,
}))

vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {}, ensureInstagramConfigTable: async () => {} }))
vi.mock('@/lib/whatsapp/encryption', () => ({ sealSecret: (v: string) => `sealed(${v})` }))
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: async () => [], $executeRaw: async () => 1 } }))

import { subscribeWebhooks, saveSocialConnection, webhookFieldsFor, INSTAGRAM_WEBHOOK_FIELDS } from './social-connect'

const app = { appId: '123', appSecret: 'shh' }
const ALL_IG = ['instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments', 'instagram_manage_insights', 'instagram_content_publish']

beforeEach(() => {
  h.calls = []
  h.refuse = []
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const url = new URL(u)
    h.calls.push({ method: init?.method ?? 'GET', url })
    const err = h.refuse.shift() ?? null
    return new Response(JSON.stringify(err ? { error: err } : { success: true }), { status: err ? 400 : 200 })
  }))
})

const fieldsOf = (i: number) => h.calls[i].url.searchParams.get('subscribed_fields')?.split(',') ?? []

describe('which webhook fields are asked for', () => {
  it('Instagram without the insights permission: no story_insights (the field Meta refused), messages kept', () => {
    const f = webhookFieldsFor('instagram', ALL_IG.filter((s) => s !== 'instagram_manage_insights'))
    expect(f).not.toContain('story_insights')
    expect(f).toContain('messages')
    expect(f).toContain('comments')
  })

  it('Instagram without the comments permission: no comments, live_comments or mentions', () => {
    const f = webhookFieldsFor('instagram', ['instagram_basic', 'instagram_manage_messages'])
    expect(f).not.toContain('comments')
    expect(f).not.toContain('live_comments')
    expect(f).not.toContain('mentions')
    expect(f).toContain('messages')
  })

  it('Instagram with every permission: every field we handle', () => {
    expect(webhookFieldsFor('instagram', ALL_IG)).toEqual([...INSTAGRAM_WEBHOOK_FIELDS])
  })

  it('Page without Lead Ads permission: no leadgen', () => {
    expect(webhookFieldsFor('page', ['pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'])).not.toContain('leadgen')
    expect(webhookFieldsFor('page', ['pages_messaging', 'leads_retrieval'])).toContain('leadgen')
  })
})

describe('subscribing', () => {
  it('Meta refuses the full set: the standard messaging + comment fields are tried next, comments kept', async () => {
    h.refuse = [{ code: 200, message: '(#200) Requires instagram_manage_insights permission to manage the object' }]
    const r = await subscribeWebhooks('instagram', '1784', 'EAAbisu', app)
    expect(r).toEqual({ ok: true, limited: true })
    expect(h.calls).toHaveLength(2)
    expect(fieldsOf(1)).toEqual(['messages', 'messaging_postbacks', 'messaging_seen', 'message_reactions', 'messaging_referral', 'comments', 'live_comments', 'mentions'])
    expect(fieldsOf(1)).not.toContain('story_insights')
  })

  it('the standard set refused too: messages alone, so the Inbox still works', async () => {
    h.refuse = [{ code: 200, message: 'x' }, { code: 100, message: 'y' }]
    const r = await subscribeWebhooks('instagram', '1784', 'EAAbisu', app)
    expect(r).toEqual({ ok: true, limited: true })
    expect(h.calls).toHaveLength(3)
    expect(fieldsOf(2)).toEqual(['messages', 'messaging_postbacks'])
  })

  it('message_edit is never asked for (not in Meta\'s Unified Login webhook list)', () => {
    expect(INSTAGRAM_WEBHOOK_FIELDS).not.toContain('message_edit')
    expect(webhookFieldsFor('instagram', ALL_IG)).not.toContain('message_edit')
  })

  it('every try refused: a plain-words error, never Meta\'s own text', async () => {
    h.refuse = [{ code: 200, message: '(#200) raw meta text' }, { code: 200, message: '(#200) raw meta text' }, { code: 200, message: '(#200) raw meta text' }]
    const r = await subscribeWebhooks('instagram', '1784', 'EAAbisu', app)
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toMatch(/#200|raw meta text/)
    expect(JSON.stringify(r)).toMatch(/Reconnect/)
  })

  it('an expired token is not retried', async () => {
    h.refuse = [{ code: 190, message: 'expired' }]
    const r = await subscribeWebhooks('instagram', '1784', 'EAAbisu', app)
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/expired/) })
    expect(h.calls).toHaveLength(1)
  })

  it('saving an Instagram connection subscribes with the granted permissions', async () => {
    const r = await saveSocialConnection({
      accountId: 'acc-1', token: 'EAAbisu', app, page: null,
      instagram: { id: '1784', username: 'acsti', name: null }, instagramPageId: '1029',
      scopes: ['instagram_basic', 'instagram_manage_messages'], expiresAt: null,
    })
    expect(r.instagram).toMatchObject({ connected: true })
    expect(r.facebook).toBeNull()
    expect(fieldsOf(0)).not.toContain('story_insights')
    expect(fieldsOf(0)).not.toContain('comments')
  })
})
