import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each WhatsApp number sends from its own catalog (one per WhatsApp
 * Business Account, Meta's rule), else the default. Linking only works for
 * this workspace's own catalog and WhatsApp account, uses that account's
 * token, sets catalog / cart on each of its numbers, and reports failures
 * in plain words.
 */

const h = vi.hoisted(() => ({
  link: null as { catalog_id: string } | null,
  def: null as { catalog_id: string } | null,
  legacy: null as { catalog_id: string; access_token?: string } | null,
  catalogRow: { id: 'mc1' } as { id: string } | null,
  numbers: [{ phone_number_id: '5551', access_token: 'enc:WA' }, { phone_number_id: '5552', access_token: 'enc:WA' }] as Array<{ phone_number_id: string; access_token: string }>,
  upserts: [] as Array<{ create: Record<string, unknown>; update: Record<string, unknown> }>,
  calls: [] as Array<{ url: string; auth?: string; body?: string }>,
  linkStatus: 200,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc:/, ''), openStoredSecret: (v: string | null) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    wabaCatalog: {
      findUnique: async () => h.link,
      upsert: async (a: { create: Record<string, unknown>; update: Record<string, unknown> }) => { h.upserts.push(a); return {} },
    },
    metaCatalog: { findFirst: async ({ where }: { where: Record<string, unknown> }) => ('is_default' in where ? h.def : h.catalogRow) },
    catalogConfig: { findUnique: async () => h.legacy, findFirst: async () => null },
    whatsAppConfig: { findMany: async ({ where }: { where: { account_id: string } }) => (where.account_id === 'acc' ? h.numbers : []) },
  },
}))

import { catalogForWaba, linkCatalogToWaba } from './for-number'

beforeEach(() => {
  h.link = null; h.def = null; h.legacy = null; h.catalogRow = { id: 'mc1' }; h.upserts = []; h.calls = []; h.linkStatus = 200
  h.numbers = [{ phone_number_id: '5551', access_token: 'enc:WA' }, { phone_number_id: '5552', access_token: 'enc:WA' }]
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    h.calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body: init?.body as string | undefined })
    if (url.endsWith('/product_catalogs')) return h.linkStatus === 200 ? Response.json({ success: true }) : Response.json({ error: { code: 10, message: 'raw meta text' } }, { status: h.linkStatus })
    return Response.json({ success: true })
  }))
})

describe('which catalog a number uses', () => {
  it('its own WhatsApp account’s catalog first, then the default, then the old single one', async () => {
    h.link = { catalog_id: '900' }; h.def = { catalog_id: '800' }; h.legacy = { catalog_id: '700' }
    expect(await catalogForWaba('acc', '123')).toBe('900')
    h.link = null
    expect(await catalogForWaba('acc', '123')).toBe('800')
    h.def = null
    expect(await catalogForWaba('acc', '123')).toBe('700')
    h.legacy = null
    expect(await catalogForWaba('acc', '123')).toBeNull()
  })
})

describe('linking a catalog to a WhatsApp account', () => {
  const base = { accountId: 'acc', userId: 'u1', wabaId: '123', catalogId: '900', catalogVisible: true, cartEnabled: false }

  it('uses that account’s own token, then sets catalog / cart on each of its numbers, then remembers it', async () => {
    expect(await linkCatalogToWaba(base)).toEqual({ ok: true })
    expect(h.calls[0].url).toMatch(/\/123\/product_catalogs$/)
    expect(h.calls[0].auth).toBe('Bearer WA')
    expect(JSON.parse(h.calls[0].body ?? '{}')).toEqual({ catalog_id: '900' })
    const settings = h.calls.slice(1).map((c) => new URL(c.url))
    expect(settings.map((u) => u.pathname.split('/')[2])).toEqual(['5551', '5552'])
    expect(settings[0].searchParams.get('is_cart_enabled')).toBe('false')
    expect(h.upserts[0].update).toMatchObject({ catalog_id: '900', cart_enabled: false, last_error: null })
  })

  it('a catalog not connected here, or another workspace’s WhatsApp account: refused, Meta never called', async () => {
    h.catalogRow = null
    expect(await linkCatalogToWaba(base)).toMatchObject({ ok: false })
    h.catalogRow = { id: 'mc1' }
    expect(await linkCatalogToWaba({ ...base, accountId: 'other' })).toMatchObject({ ok: false })
    expect(await linkCatalogToWaba({ ...base, wabaId: '12;3' })).toMatchObject({ ok: false })
    expect(h.calls).toHaveLength(0)
  })

  it('Meta refuses: a plain-words error is saved and returned, never Meta’s own text', async () => {
    h.linkStatus = 400
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await linkCatalogToWaba(base)
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toMatch(/raw meta text/)
    expect(String(h.upserts[0].update.last_error)).toMatch(/catalog_management/)
  })
})
