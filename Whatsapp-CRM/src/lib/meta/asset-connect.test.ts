import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Connect Ads / Connect Catalog (server side): only the assets the
 * business shared are read, ids are validated, several are saved with one
 * default, and a workspace can never change another workspace's rows.
 */

type Row = Record<string, unknown> & { id: string; account_id: string }
const h = vi.hoisted(() => ({
  routes: {} as Record<string, unknown>,
  calls: [] as URL[],
  conns: [] as Array<Record<string, unknown>>,
  ads: [] as Array<Record<string, unknown>>,
  legacyAds: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  sealSecret: (v: string) => `sealed:${v}`,
  openStoredSecret: (v: string | null) => (v ? v.replace(/^(sealed|enc):/, '') : null),
}))

let seq = 0
const match = (r: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (typeof v === 'object' && v !== null ? true : r[k] === v))
function table(list: () => Array<Record<string, unknown>>, set: (l: Array<Record<string, unknown>>) => void) {
  return {
    count: async ({ where }: { where: Record<string, unknown> }) => list().filter((r) => match(r, where)).length,
    findFirst: async ({ where }: { where: Record<string, unknown> }) => list().find((r) => match(r, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => list().filter((r) => match(r, where)),
    create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `id-${++seq}`, created_at: new Date(seq), ...data }; set([...list(), row]); return row },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { set(list().map((r) => (match(r, where) ? { ...r, ...data } : r))); return { count: 1 } },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => { set(list().filter((r) => !match(r, where))); return { count: 1 } },
    upsert: async ({ where, create, update }: { where: Record<string, Record<string, unknown>>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const key = Object.values(where)[0]
      const found = list().find((r) => match(r, key))
      if (found) { set(list().map((r) => (r === found ? { ...r, ...update } : r))); return found }
      const row = { id: `id-${++seq}`, created_at: new Date(seq), ...create }; set([...list(), row]); return row
    },
  }
}

vi.mock('@/lib/db', () => {
  const metaAssetConnection = table(() => h.conns, (l) => { h.conns = l })
  const metaAdAccount = table(() => h.ads, (l) => { h.ads = l })
  const prisma = {
    metaAssetConnection, metaAdAccount,
    metaCatalog: table(() => [], () => {}),
    metaAdsConfig: {
      findUnique: async () => h.legacyAds,
      update: async ({ data }: { data: Record<string, unknown> }) => { h.legacyAds = { ...(h.legacyAds ?? {}), ...data }; return h.legacyAds },
      create: async ({ data }: { data: Record<string, unknown> }) => { h.legacyAds = data; return data },
    },
    catalogConfig: { deleteMany: async () => ({}), upsert: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  return { prisma }
})

import { discoverAdAccounts, removeAsset, saveAssets, setDefaultAsset, tokenGrants } from './asset-connect'

const app = { appId: '123', appSecret: 'shh' }

beforeEach(() => {
  h.routes = {}; h.calls = []; h.conns = []; h.ads = []; h.legacyAds = null; seq = 0
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const url = new URL(u)
    h.calls.push(url)
    const body = h.routes[url.pathname] ?? { error: { code: 100, message: 'nope' } }
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 })
  }))
})

describe('what the login granted', () => {
  it('reads granular target ids and drops anything that is not an id', async () => {
    h.routes['/v27.0/debug_token'] = { data: { is_valid: true, scopes: ['ads_read'], granular_scopes: [{ scope: 'ads_read', target_ids: ['111', '../me', 222, '333'] }] } }
    const g = await tokenGrants('EAAtok', app)
    expect(g).toEqual({ valid: true, scopes: ['ads_read'], targets: { ads_read: ['111', '333'] } })
  })
})

describe('discovering ad accounts', () => {
  it('only the shared ids, each confirmed with the token (with appsecret_proof)', async () => {
    h.routes['/v27.0/act_111'] = { account_id: '111', name: 'Main', currency: 'INR', timezone_name: 'Asia/Kolkata', account_status: 1 }
    const list = await discoverAdAccounts('EAAtok', app, { valid: true, scopes: ['ads_read'], targets: { ads_read: ['111', '999'] } })
    expect(list).toEqual([{ id: '111', name: 'Main', currency: 'INR', timezone: 'Asia/Kolkata', status: 1 }])
    for (const c of h.calls) expect(c.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/)
    expect(h.calls.some((c) => c.pathname.endsWith('/me/adaccounts'))).toBe(false)
  })

  it('no granular list: falls back to the accounts the system user holds', async () => {
    h.routes['/v27.0/me/adaccounts'] = { data: [{ id: 'act_444', account_id: '444', name: 'B' }, { id: 'act_bad', account_id: 'x1' }] }
    const list = await discoverAdAccounts('EAAtok', app, { valid: true, scopes: ['ads_read'], targets: {} })
    expect(list.map((a) => a.id)).toEqual(['444'])
  })
})

describe('saving several ad accounts', () => {
  const asset = (id: string) => ({ id, name: `A${id}`, currency: 'INR', timezone: null, status: 1 })

  it('one sealed connection, every account saved, the first becomes default, mirrored for old reports', async () => {
    await saveAssets({ accountId: 'acc-1', userId: 'u1', kind: 'ads', token: 'EAAtok', scopes: ['ads_read'], assets: [asset('111'), asset('222')] })
    expect(h.conns).toHaveLength(1)
    expect(h.conns[0].access_token).toBe('sealed:EAAtok')
    expect(h.ads.map((a) => [a.ad_account_id, a.is_default])).toEqual([['111', true], ['222', false]])
    expect(h.legacyAds).toMatchObject({ ad_account_id: 'act_111', access_token: 'enc:EAAtok' })
  })

  it('another workspace cannot make or remove a default on our rows', async () => {
    await saveAssets({ accountId: 'acc-1', userId: 'u1', kind: 'ads', token: 'EAAtok', scopes: [], assets: [asset('111'), asset('222')] })
    const second = h.ads[1] as Row
    expect(await setDefaultAsset('acc-2', 'ads', second.id, 'u9')).toBe(false)
    expect(await removeAsset('acc-2', 'ads', second.id, 'u9')).toBe(false)
    expect(h.ads).toHaveLength(2)
  })

  it('removing the default hands it to the next one, and an empty connection is deleted', async () => {
    await saveAssets({ accountId: 'acc-1', userId: 'u1', kind: 'ads', token: 'EAAtok', scopes: [], assets: [asset('111'), asset('222')] })
    const first = h.ads[0] as Row
    expect(await removeAsset('acc-1', 'ads', first.id, 'u1')).toBe(true)
    expect(h.ads.map((a) => [a.ad_account_id, a.is_default])).toEqual([['222', true]])
    expect(h.legacyAds).toMatchObject({ ad_account_id: 'act_222' })
    const last = h.ads[0] as Row
    await removeAsset('acc-1', 'ads', last.id, 'u1')
    expect(h.conns).toHaveLength(0)
    expect(h.legacyAds).toMatchObject({ ad_account_id: null })
  })
})
