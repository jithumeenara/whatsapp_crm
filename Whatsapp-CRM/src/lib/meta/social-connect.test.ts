import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One-click connect (server side): what is read from Meta, what is
 * subscribed, and that a workspace can never take a Page / Instagram
 * account another workspace holds.
 */

const h = vi.hoisted(() => ({
  taken: false,
  writes: [] as string[],
  calls: [] as Array<{ method: string; url: URL }>,
  routes: {} as Record<string, unknown>,
}))

vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {}, ensureInstagramConfigTable: async () => {} }))
vi.mock('@/lib/whatsapp/encryption', () => ({ sealSecret: (v: string) => `sealed(${v})` }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async () => (h.taken ? [{ n: 1 }] : []),
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.writes.push(strings.join('?') + ' :: ' + JSON.stringify(values)); return 1 },
  },
}))

import { discoverAssets, exchangeCode, saveSocialConnection, subscribeWebhooks, tokenInfo, INSTAGRAM_WEBHOOK_FIELDS, PAGE_WEBHOOK_FIELDS } from './social-connect'

const app = { appId: '123', appSecret: 'shh' }

beforeEach(() => {
  h.taken = false
  h.writes = []
  h.calls = []
  h.routes = {}
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const url = new URL(u)
    h.calls.push({ method: init?.method ?? 'GET', url })
    const body = h.routes[url.pathname] ?? { success: true }
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 })
  }))
})

describe('one-click connect: talking to Meta', () => {
  it('exchanges the code server side and never accepts a strange code', async () => {
    h.routes['/v27.0/oauth/access_token'] = { access_token: 'EAAbisu' }
    expect(await exchangeCode('AQD_valid-code_1234567', 'https://crm.example/api/meta/social-connect/callback', app)).toBe('EAAbisu')
    const call = h.calls[0].url
    expect(call.searchParams.get('client_secret')).toBe('shh')
    expect(call.searchParams.get('redirect_uri')).toBe('https://crm.example/api/meta/social-connect/callback')
    await expect(exchangeCode('bad code with spaces', 'x', app)).rejects.toThrow(/unexpected code/)
  })

  it('reads the permissions and expiry; "never expires" is null', async () => {
    h.routes['/v27.0/debug_token'] = { data: { is_valid: true, scopes: ['pages_messaging', 'instagram_manage_messages'], expires_at: 0 } }
    expect(await tokenInfo('EAAbisu', app)).toEqual({ valid: true, scopes: ['pages_messaging', 'instagram_manage_messages'], expiresAt: null })
  })

  it('lists Pages (with their own tokens) and Instagram accounts, once each, with appsecret_proof', async () => {
    h.routes['/v27.0/me/accounts'] = { data: [
      { id: '1029', name: 'ACSTI', access_token: 'EAApage', instagram_business_account: { id: '1784', username: 'acsti' } },
      { id: 'not-a-number', name: 'Bad', access_token: 'x' },
    ] }
    h.routes['/v27.0/me/assigned_instagram_accounts'] = { data: [{ id: '1784', username: 'acsti' }, { id: '9999', username: 'other' }] }
    const r = await discoverAssets('EAAbisu', app)
    expect(r.pages).toEqual([{ id: '1029', name: 'ACSTI', token: 'EAApage', igId: '1784' }])
    expect(r.instagram.map((i) => i.id)).toEqual(['1784', '9999'])
    for (const c of h.calls) expect(c.url.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('subscribes every webhook field we handle', async () => {
    await subscribeWebhooks('page', '1029', 'EAApage', app)
    await subscribeWebhooks('instagram', '1784', 'EAAbisu', app)
    expect(h.calls[0].method).toBe('POST')
    expect(h.calls[0].url.pathname).toBe('/v27.0/1029/subscribed_apps')
    expect(h.calls[0].url.searchParams.get('subscribed_fields')).toBe(PAGE_WEBHOOK_FIELDS.join(','))
    expect(h.calls[1].url.pathname).toBe('/v27.0/1784/subscribed_apps')
    expect(h.calls[1].url.searchParams.get('subscribed_fields')).toBe(INSTAGRAM_WEBHOOK_FIELDS.join(','))
    expect(await subscribeWebhooks('page', '1/../me', 'x', app)).toEqual({ ok: false, error: 'Invalid account id.' })
  })
})

describe('one-click connect: saving', () => {
  const page = { id: '1029', name: 'ACSTI', token: 'EAApage', igId: '1784' }
  const ig = { id: '1784', username: 'acsti', name: 'ACSTI' }

  it('saves both, tokens sealed, marked as connected by login, and subscribes', async () => {
    const r = await saveSocialConnection({ accountId: 'acc-1', token: 'EAAbisu', app, page, instagram: ig, scopes: ['pages_messaging'], expiresAt: null })
    expect(r.facebook).toMatchObject({ connected: true, name: 'ACSTI' })
    expect(r.instagram).toMatchObject({ connected: true, name: 'acsti' })
    expect(h.writes.join('\n')).toContain('sealed(EAApage)')
    expect(h.writes.join('\n')).toContain('sealed(EAAbisu)')
    expect(h.writes.join('\n')).not.toMatch(/"EAApage"|"EAAbisu"/)
    expect(h.calls.filter((c) => c.url.pathname.endsWith('/subscribed_apps'))).toHaveLength(2)
  })

  it('refuses an account another workspace holds, and writes nothing', async () => {
    h.taken = true
    const r = await saveSocialConnection({ accountId: 'acc-2', token: 'EAAbisu', app, page, instagram: ig, scopes: [], expiresAt: null })
    expect(r.facebook).toMatchObject({ connected: false, error: expect.stringMatching(/another workspace/) })
    expect(r.instagram).toMatchObject({ connected: false })
    expect(h.writes).toHaveLength(0)
    expect(h.calls).toHaveLength(0)
  })
})
