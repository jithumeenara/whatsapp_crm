import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Choosing after "Connect Instagram" accepts only an Instagram account;
 * after "Connect Messenger" only a Page. The session (server side) decides,
 * never the request.
 */

const SID = '00000000-0000-0000-0000-0000000000aa'
const h = vi.hoisted(() => ({ channel: 'instagram' as 'instagram' | 'facebook', saved: [] as Array<{ page: unknown; instagram: unknown; instagramPageId?: unknown }> }))

vi.mock('@/lib/auth/account', () => ({ requireRole: async () => ({ accountId: 'acc-1', userId: 'owner-1' }), toErrorResponse: (e: Error) => new Response(e.message, { status: 500 }) }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/meta/social-connect', () => ({
  saveSocialConnection: async (a: { page: unknown; instagram: unknown; instagramPageId?: unknown }) => { h.saved.push(a); return { facebook: null, instagram: { connected: true } } },
}))
vi.mock('@/lib/meta/social-connect-server', () => ({
  loadSocialApp: async () => ({ appId: '1', appSecret: 's', configId: 'c' }),
  readConnectChoices: async () => null,
  claimConnectSession: async () => ({
    token: 'EAAbisu',
    channel: h.channel,
    pages: [{ id: '1029', name: 'ACSTI', igId: '1784', token: h.channel === 'instagram' ? '' : 'EAApage' }],
    instagram: h.channel === 'instagram' ? [{ id: '1784', username: 'acsti', name: null }] : [],
    scopes: [],
    expiresAt: null,
  }),
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('https://crm.example/api/meta/social-connect/finish', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { h.saved = [] })

describe('choosing within one channel', () => {
  it('Instagram session: the account is saved, its Page only noted', async () => {
    h.channel = 'instagram'
    const res = await post({ session: SID, instagram_id: '1784' })
    expect(res.status).toBe(200)
    expect(h.saved[0]).toMatchObject({ page: null, instagram: { id: '1784' }, instagramPageId: '1029' })
  })

  it('Instagram session: a Page sent anyway is refused, nothing saved', async () => {
    h.channel = 'instagram'
    const res = await post({ session: SID, page_id: '1029', instagram_id: '1784' })
    expect(res.status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })

  it('Messenger session: an Instagram account sent anyway is refused, nothing saved', async () => {
    h.channel = 'facebook'
    const res = await post({ session: SID, page_id: '1029', instagram_id: '1784' })
    expect(res.status).toBe(400)
    expect(h.saved).toHaveLength(0)
  })
})
