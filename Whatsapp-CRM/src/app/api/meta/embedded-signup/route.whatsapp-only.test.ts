import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * WhatsApp Embedded Signup connects WhatsApp only. It used to also take
 * the FIRST ad account (/me/adaccounts data[0]), the only catalog, and the
 * Pages/Instagram it could see — silently choosing for the business. Each
 * of those now has its own Connect button. It must also never overwrite a
 * token that "Connect Ads" saved.
 */

const h = vi.hoisted(() => ({
  urls: [] as string[],
  adsRow: null as { ad_account_id: string | null } | null,
  adsUpdates: [] as Array<Record<string, unknown>>,
  adsCreates: 0,
  catalogWrites: 0,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'a1', userId: 'u1', role: 'owner' }) }
})
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/whatsapp/meta-platform-config', () => ({ loadMetaPlatformConfig: async () => ({ appId: 'app', appSecret: 's' }) }))
vi.mock('@/lib/meta-ads/api', () => ({ createOrGetDataset: async () => ({ datasetId: 'ds-1' }) }))
vi.mock('@/lib/whatsapp/encryption', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/encryption')>('@/lib/whatsapp/encryption')
  return { ...actual, encrypt: (v: string) => `enc:${v}` }
})
vi.mock('@/lib/whatsapp/meta-api', () => ({
  exchangeEmbeddedSignupCode: async () => ({ accessToken: 'whatsapp-business-token' }),
  subscribeWabaToApp: async () => {},
  registerPhoneNumber: async () => {},
  verifyPhoneNumber: async () => ({}),
  listWabaPhoneNumberIds: async () => ['111'],
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    whatsAppConfig: { findFirst: async () => null, count: async () => 0, create: async () => ({}), update: async () => ({}) },
    metaAdsConfig: {
      findUnique: async () => h.adsRow,
      update: async (a: { data: Record<string, unknown> }) => { h.adsUpdates.push(a.data); return {} },
      create: async () => { h.adsCreates++; return {} },
      upsert: async () => { throw new Error('must not upsert an ad account') },
    },
    catalogConfig: { upsert: async () => { h.catalogWrites++; return {} } },
    $executeRaw: async () => { throw new Error('must not write Page / Instagram rows') },
    $queryRaw: async () => [],
  },
}))

globalThis.fetch = (async (url: string) => {
  h.urls.push(String(url))
  const m = /\/v[\d.]+\/([^/?]+)\/phone_numbers/.exec(String(url))
  if (m) return Response.json({ data: [{ id: '111' }] })
  return Response.json({ data: [{ id: 'act_999', name: 'Someone else' }] })
}) as typeof fetch

import { POST } from './route'

const signup = () => POST(new NextRequest('http://x/api/meta/embedded-signup', { method: 'POST', body: JSON.stringify({ code: 'c', wabaId: 'waba-1', phoneNumberId: '111' }) }))

beforeEach(() => { h.urls = []; h.adsRow = null; h.adsUpdates = []; h.adsCreates = 0; h.catalogWrites = 0 })

describe('Embedded Signup is WhatsApp only', () => {
  it('never looks up ad accounts, businesses/catalogs or Pages, and saves no catalog', async () => {
    const res = await signup()
    expect(res.status).toBe(200)
    expect(h.urls.some((u) => /\/me\/(adaccounts|businesses|accounts)/.test(u))).toBe(false)
    expect(h.catalogWrites).toBe(0)
  })

  it('keeps the WABA dataset for Conversions API, with no ad account', async () => {
    await signup()
    expect(h.adsCreates).toBe(1)
  })

  it('never overwrites the token of an ads connection that chose an ad account', async () => {
    h.adsRow = { ad_account_id: '123' }
    await signup()
    expect(h.adsUpdates).toHaveLength(1)
    expect(h.adsUpdates[0]).toEqual({ waba_id: 'waba-1', dataset_id: 'ds-1' })
  })
})
