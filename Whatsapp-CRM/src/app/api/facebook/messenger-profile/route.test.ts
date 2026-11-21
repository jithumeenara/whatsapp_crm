import { beforeEach, describe, expect, it, vi } from 'vitest'

// Messenger greeting / Get Started / starters / menu: owner only, the
// workspace's own Page, cleaned input, plain errors, the token stays here.

const h = vi.hoisted(() => ({
  row: { access_token: 'sealed', page_id: '1234567890', messenger_profile: null, profile_synced_at: null } as Record<string, unknown> | undefined,
  calls: [] as Array<{ url: string; method: string; body: unknown }>,
  writes: [] as string[],
  metaFails: false,
  forbidden: false,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => { if (h.forbidden) throw Object.assign(new Error('forbidden'), { status: 403 }); return { accountId: 'acc-1', role: 'owner', userId: 'u' } },
  toErrorResponse: (e: { status?: number }) => new Response(null, { status: e.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/social/ensure-tables', () => ({ ensureFacebookConfigTable: async () => {} }))
vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string | null) => (v ? 'EAApage' : null) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.writes.push(`q:${values.join(',')}`); return h.row ? [h.row] : [] },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.writes.push(strings.join('?') + JSON.stringify(values)); return 1 },
  },
}))

import { GET, PATCH } from './route'

const patch = (body: unknown) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  h.row = { access_token: 'sealed', page_id: '1234567890', messenger_profile: null, profile_synced_at: null }
  h.calls = []; h.writes = []; h.metaFails = false; h.forbidden = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    h.calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null })
    return h.metaFails
      ? new Response(JSON.stringify({ error: { code: 10, message: 'raw (#10) fbtrace_id=Zz' } }), { status: 400 })
      : new Response(JSON.stringify({ result: 'success' }), { status: 200 })
  }))
})

describe('Messenger profile', () => {
  it('saves to the workspace\'s own Page and stores only the cleaned profile', async () => {
    const res = await patch({ greeting: 'Hi', persistent_menu: [{ title: 'Help', payload: 'HELP', evil: 1 }] })
    expect(res.status).toBe(200)
    expect(h.calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.0\/1234567890\/messenger_profile\?access_token=EAApage$/)
    expect(h.calls[0].body).toMatchObject({ get_started: { payload: 'GET_STARTED' }, greeting: [{ locale: 'default', text: 'Hi' }] })
    const stored = h.writes.find((w) => w.includes('UPDATE facebook_config')) ?? ''
    expect(stored).not.toContain('evil')
    expect(stored).toContain('acc-1')
  })
  it('a bad link is refused before anything is sent', async () => {
    const res = await patch({ persistent_menu: [{ title: 'x', type: 'web_url', url: 'javascript:alert(1)' }] })
    expect(res.status).toBe(400)
    expect(h.calls).toEqual([])
  })
  it('a Page id that is not a number is never put in the URL', async () => {
    h.row = { ...h.row, page_id: '../me/accounts' }
    const res = await patch({ greeting: 'Hi' })
    expect(res.status).toBe(400)
    expect(h.calls).toEqual([])
  })
  it('Meta refusing answers in plain words, not Meta\'s raw text', async () => {
    h.metaFails = true
    const res = await patch({ greeting: 'Hi' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).not.toContain('fbtrace')
    expect(h.writes.some((w) => w.includes('UPDATE facebook_config'))).toBe(false)
  })
  it('GET never returns the token', async () => {
    const body = await (await GET()).json()
    expect(JSON.stringify(body)).not.toContain('EAA')
    expect(JSON.stringify(body)).not.toContain('sealed')
  })
  it('not the owner: refused', async () => {
    h.forbidden = true
    expect((await patch({ greeting: 'Hi' })).status).toBe(403)
  })
})
