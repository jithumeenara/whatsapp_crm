import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * One button per channel: "Connect Instagram" saves only an Instagram
 * account, "Connect Messenger" only a Page — even when Meta shares both.
 * The channel travels inside the signed state, so it cannot be swapped.
 */

const h = vi.hoisted(() => ({
  saved: [] as Array<{ page: unknown; instagram: unknown; instagramPageId?: unknown }>,
  sessions: [] as Array<{ pages: Array<{ token: string }>; instagram: unknown[]; channel?: string }>,
  appFor: [] as unknown[],
  pages: [] as unknown[],
  instagram: [] as unknown[],
}))

vi.mock('@/lib/auth/account', () => ({ requireRole: async () => ({ accountId: 'acc-1', userId: 'owner-1' }) }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/meta/social-connect', () => ({
  exchangeCode: async () => 'EAAbisu',
  tokenInfo: async () => ({ valid: true, scopes: ['instagram_manage_messages', 'pages_messaging'], expiresAt: null }),
  discoverAssets: async () => ({ pages: h.pages, instagram: h.instagram }),
  saveSocialConnection: async (a: { page: unknown; instagram: unknown; instagramPageId?: unknown }) => {
    h.saved.push(a)
    return { facebook: a.page ? { connected: true } : null, instagram: a.instagram ? { connected: true } : null }
  },
}))
vi.mock('@/lib/meta/social-connect-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta/social-connect-server')>('@/lib/meta/social-connect-server')
  return {
    ...actual,
    connectOrigin: () => 'https://crm.example',
    loadSocialApp: async (channel?: string) => { h.appFor.push(channel); return { appId: '123', appSecret: 'shh', configId: 'cfg' } },
    createConnectSession: async (s: { pages: Array<{ token: string }>; instagram: unknown[]; channel?: string }) => { h.sessions.push(s); return '00000000-0000-0000-0000-0000000000aa' },
  }
})

import { GET } from './route'
import { newNonce, signConnectState, type SocialChannel } from '@/lib/meta/connect-state'

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-callback-channel' })
beforeEach(() => {
  h.saved = []
  h.sessions = []
  h.appFor = []
  h.pages = [{ id: '1029', name: 'ACSTI', token: 'EAApage', igId: '1784' }]
  h.instagram = [{ id: '1784', username: 'acsti', name: null }]
})

function back(channel: SocialChannel) {
  const nonce = newNonce()
  const url = new URL('https://crm.example/api/meta/social-connect/callback')
  url.searchParams.set('code', 'AQDvalidcode123')
  url.searchParams.set('state', signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce, channel }))
  return GET(new NextRequest(url, { headers: { cookie: `meta_connect_nonce=${nonce}` } }))
}
const result = (res: Response) => new URL(res.headers.get('location') ?? '').searchParams

describe('one channel per button', () => {
  it('Connect Instagram: only the Instagram account is saved, its Page only noted', async () => {
    const res = await back('instagram')
    expect(result(res).get('meta_connect')).toBe('connected')
    expect(h.saved).toHaveLength(1)
    expect(h.saved[0].page).toBeNull()
    expect(h.saved[0].instagram).toMatchObject({ id: '1784' })
    expect(h.saved[0].instagramPageId).toBe('1029')
    expect(h.appFor).toEqual(['instagram'])
  })

  it('Connect Messenger: only the Page is saved, never the Instagram account', async () => {
    const res = await back('facebook')
    expect(result(res).get('meta_connect')).toBe('connected')
    expect(h.saved[0].page).toMatchObject({ id: '1029' })
    expect(h.saved[0].instagram).toBeNull()
    expect(h.appFor).toEqual(['facebook'])
  })

  it('Connect Instagram works without any Facebook Page', async () => {
    h.pages = []
    const res = await back('instagram')
    expect(result(res).get('meta_connect')).toBe('connected')
    expect(h.saved[0].instagram).toMatchObject({ id: '1784' })
    expect(h.saved[0].instagramPageId).toBeNull()
  })

  it('Connect Instagram with no Instagram account shared: a clear fixed code, nothing saved', async () => {
    h.instagram = []
    const res = await back('instagram')
    expect(result(res).get('meta_connect')).toBe('error')
    expect(result(res).get('code')).toBe('no_instagram')
    expect(h.saved).toHaveLength(0)
  })

  it('Connect Messenger with no Page shared: "no_page", nothing saved', async () => {
    h.pages = []
    const res = await back('facebook')
    expect(result(res).get('code')).toBe('no_page')
    expect(h.saved).toHaveLength(0)
  })

  it('several Instagram accounts: the choice session is for Instagram, and keeps no Page tokens', async () => {
    h.instagram = [{ id: '1784', username: 'a', name: null }, { id: '1785', username: 'b', name: null }]
    const res = await back('instagram')
    expect(result(res).get('meta_connect')).toBe('choose')
    expect(h.sessions[0].channel).toBe('instagram')
    expect(h.sessions[0].pages.every((p) => p.token === '')).toBe(true)
  })

  it('a state whose channel was edited is refused (signature), nothing saved', async () => {
    const nonce = newNonce()
    const [enc, sig] = signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce, channel: 'instagram' }).split('.')
    const body = JSON.parse(Buffer.from(enc, 'base64url').toString())
    body.channel = 'facebook'
    const forged = `${Buffer.from(JSON.stringify(body)).toString('base64url')}.${sig}`
    const url = new URL('https://crm.example/api/meta/social-connect/callback')
    url.searchParams.set('code', 'AQDvalidcode123')
    url.searchParams.set('state', forged)
    const res = await GET(new NextRequest(url, { headers: { cookie: `meta_connect_nonce=${nonce}` } }))
    expect(result(res).get('meta_connect')).toBe('error')
    expect(h.saved).toHaveLength(0)
  })
})
