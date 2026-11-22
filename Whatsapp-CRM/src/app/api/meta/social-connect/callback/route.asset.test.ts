import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Meta's redirect after "Connect Ads" / "Connect Catalog": goes back to the
 * Ads / Catalog tab; one shared asset is saved at once, several open the
 * checkbox chooser; a login without the asset permission saves nothing.
 * The kind is inside the signed state.
 */

const h = vi.hoisted(() => ({
  scopes: ['ads_read'] as string[],
  assets: [{ id: '111', name: 'A', currency: 'INR', timezone: null, status: 1 }] as unknown[],
  saved: [] as unknown[],
  sessions: [] as Array<{ kind: string }>,
  socialSaved: 0,
}))

vi.mock('@/lib/auth/account', () => ({ requireRole: async () => ({ accountId: 'acc-1', userId: 'owner-1' }) }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/meta/social-connect', () => ({
  exchangeCode: async () => 'EAAbisu',
  tokenInfo: async () => ({ valid: true, scopes: [], expiresAt: null }),
  discoverAssets: async () => ({ pages: [], instagram: [] }),
  saveSocialConnection: async () => { h.socialSaved++; return { facebook: null, instagram: null } },
}))
vi.mock('@/lib/meta/asset-connect', () => ({
  tokenGrants: async () => ({ valid: true, scopes: h.scopes, targets: {} }),
  hasAssetScope: (kind: string, scopes: string[]) => (kind === 'ads' ? scopes.includes('ads_read') : scopes.includes('catalog_management')),
  discoverAdAccounts: async () => h.assets,
  discoverCatalogs: async () => h.assets,
  saveAssets: async (a: unknown) => { h.saved.push(a); return { saved: 1 } },
  createAssetSession: async (s: { kind: string }) => { h.sessions.push(s); return '00000000-0000-0000-0000-0000000000cc' },
}))
vi.mock('@/lib/meta/social-connect-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta/social-connect-server')>('@/lib/meta/social-connect-server')
  return { ...actual, connectOrigin: () => 'https://crm.example', loadSocialApp: async () => ({ appId: '123', appSecret: 'shh', configId: 'cfg' }) }
})

import { GET } from './route'
import { newNonce, signConnectState, type ConnectKind } from '@/lib/meta/connect-state'

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-asset-callback' })
beforeEach(() => {
  h.scopes = ['ads_read']; h.saved = []; h.sessions = []; h.socialSaved = 0
  h.assets = [{ id: '111', name: 'A', currency: 'INR', timezone: null, status: 1 }]
})

function back(kind: ConnectKind) {
  const nonce = newNonce()
  const url = new URL('https://crm.example/api/meta/social-connect/callback')
  url.searchParams.set('code', 'AQDvalidcode123')
  url.searchParams.set('state', signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce, channel: kind }))
  return GET(new NextRequest(url, { headers: { cookie: `meta_connect_nonce=${nonce}` } }))
}
const loc = (res: Response) => new URL(res.headers.get('location') ?? '')

describe('Connect Ads / Connect Catalog redirect', () => {
  it('one ad account shared: saved now, back to the Ads tab', async () => {
    const u = loc(await back('ads'))
    expect(u.searchParams.get('tab')).toBe('ads')
    expect(u.searchParams.get('meta_connect')).toBe('connected')
    expect(h.saved).toHaveLength(1)
    expect(h.socialSaved).toBe(0)
  })

  it('several shared: a choice session for this kind, nothing saved yet, no token in the URL', async () => {
    h.assets = [{ id: '111', name: 'A' }, { id: '222', name: 'B' }]
    const u = loc(await back('ads'))
    expect(u.searchParams.get('meta_connect')).toBe('choose_asset')
    expect(h.sessions[0].kind).toBe('ads')
    expect(h.saved).toHaveLength(0)
    expect(u.toString()).not.toMatch(/EAA/)
  })

  it('a catalog login without catalog permission: fixed code, back to the Catalog tab, nothing saved', async () => {
    h.scopes = ['ads_read']
    const u = loc(await back('catalog'))
    expect(u.searchParams.get('tab')).toBe('catalog')
    expect(u.searchParams.get('code')).toBe('no_catalog_permission')
    expect(h.saved).toHaveLength(0)
  })

  it('nothing shared: "no_ad_account"', async () => {
    h.assets = []
    expect(loc(await back('ads')).searchParams.get('code')).toBe('no_ad_account')
  })
})
