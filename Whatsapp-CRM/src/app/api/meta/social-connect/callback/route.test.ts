import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The Meta redirect (GET /api/meta/social-connect/callback) — accepted only
 * from the browser and owner that started it; the code is exchanged on the
 * server; nothing is saved otherwise.
 */

const h = vi.hoisted(() => ({
  ctx: { accountId: 'acc-1', userId: 'owner-1' } as { accountId: string; userId: string } | null,
  exchanged: 0,
  exchangeError: null as string | null,
  saved: [] as unknown[],
  sessions: 0,
  pages: [{ id: '1029', name: 'ACSTI', token: 'EAApage', igId: '1784' }] as unknown[],
  instagram: [{ id: '1784', username: 'acsti', name: null }] as unknown[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => { if (!h.ctx) throw new Error('Unauthorized'); return h.ctx },
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/meta/social-connect', () => ({
  exchangeCode: async () => { h.exchanged++; if (h.exchangeError) throw new Error(h.exchangeError); return 'EAAbisu' },
  tokenInfo: async () => ({ valid: true, scopes: ['pages_messaging'], expiresAt: null }),
  discoverAssets: async () => ({ pages: h.pages, instagram: h.instagram }),
  saveSocialConnection: async (a: unknown) => { h.saved.push(a); return { facebook: { connected: true }, instagram: { connected: true } } },
}))
vi.mock('@/lib/meta/social-connect-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta/social-connect-server')>('@/lib/meta/social-connect-server')
  return {
    ...actual,
    connectOrigin: () => 'https://crm.example',
    loadSocialApp: async () => ({ appId: '123', appSecret: 'shh', configId: 'cfg' }),
    createConnectSession: async () => { h.sessions++; return '00000000-0000-0000-0000-0000000000aa' },
  }
})

import { GET } from './route'
import { newNonce, signConnectState } from '@/lib/meta/connect-state'

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-callback' })
beforeEach(() => {
  h.ctx = { accountId: 'acc-1', userId: 'owner-1' }
  h.exchanged = 0
  h.exchangeError = null
  h.saved = []
  h.sessions = 0
  h.pages = [{ id: '1029', name: 'ACSTI', token: 'EAApage', igId: '1784' }]
  h.instagram = [{ id: '1784', username: 'acsti', name: null }]
})

function call(params: Record<string, string>, cookieNonce?: string) {
  const url = new URL('https://crm.example/api/meta/social-connect/callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const req = new NextRequest(url, { headers: cookieNonce ? { cookie: `meta_connect_nonce=${cookieNonce}` } : {} })
  return GET(req)
}
const loc = (res: Response) => new URL(res.headers.get('location') ?? '')

describe('Meta redirect back to the CRM', () => {
  it('the starting browser and owner: code exchanged, one Page + one account saved', async () => {
    const nonce = newNonce()
    const res = await call({ code: 'AQDvalidcode123', state: signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce }) }, nonce)
    expect(loc(res).searchParams.get('meta_connect')).toBe('connected')
    expect(h.exchanged).toBe(1)
    expect(h.saved).toHaveLength(1)
    expect(res.headers.get('set-cookie')).toMatch(/meta_connect_nonce=;/)
  })

  it('another browser (no or wrong nonce cookie): refused, nothing exchanged or saved', async () => {
    const state = signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce: newNonce() })
    for (const cookie of [undefined, newNonce()]) {
      const res = await call({ code: 'AQDvalidcode123', state }, cookie)
      expect(loc(res).searchParams.get('meta_connect')).toBe('error')
    }
    expect(h.exchanged).toBe(0)
    expect(h.saved).toHaveLength(0)
  })

  it("a state made for another workspace or person is refused (can't attach to someone else)", async () => {
    const nonce = newNonce()
    const res = await call({ code: 'AQDvalidcode123', state: signConnectState({ accountId: 'acc-2', userId: 'owner-1', nonce }) }, nonce)
    expect(loc(res).searchParams.get('meta_connect')).toBe('error')
    expect(h.exchanged).toBe(0)
  })

  it('not signed in as an owner: refused', async () => {
    h.ctx = null
    const nonce = newNonce()
    const res = await call({ code: 'AQDvalidcode123', state: signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce }) }, nonce)
    expect(loc(res).searchParams.get('meta_connect')).toBe('error')
    expect(h.exchanged).toBe(0)
  })

  it('the customer pressed Cancel at Meta: "cancelled", nothing exchanged', async () => {
    const nonce = newNonce()
    const res = await call({ error: 'access_denied', state: signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce }) }, nonce)
    expect(loc(res).searchParams.get('meta_connect')).toBe('cancelled')
    expect(h.exchanged).toBe(0)
  })

  it('several Pages: nothing saved yet — the owner chooses (session kept server side)', async () => {
    h.pages = [{ id: '1', name: 'A', token: 'EAA1', igId: null }, { id: '2', name: 'B', token: 'EAA2', igId: null }]
    const nonce = newNonce()
    const res = await call({ code: 'AQDvalidcode123', state: signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce }) }, nonce)
    expect(loc(res).searchParams.get('meta_connect')).toBe('choose')
    expect(h.saved).toHaveLength(0)
    expect(h.sessions).toBe(1)
    expect(loc(res).toString()).not.toMatch(/EAA/)
  })

  it('the redirect carries only a fixed code, never free text (no phishing text, no raw Meta error)', async () => {
    h.exchangeError = '(#100) Invalid verification code format. fbtrace_id=AbC123 call +91 90000 00000'
    const nonce = newNonce()
    const res = await call({ code: 'AQDvalidcode123', state: signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce }) }, nonce)
    const u = loc(res)
    expect(u.searchParams.get('meta_connect')).toBe('error')
    expect(u.searchParams.has('reason')).toBe(false)
    expect(u.searchParams.get('code')).toMatch(/^[a-z_]+$/)
    expect(u.toString()).not.toMatch(/fbtrace|90000/)
  })
})
