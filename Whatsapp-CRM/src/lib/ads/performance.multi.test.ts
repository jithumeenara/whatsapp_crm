import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * P3 — cost per qualified lead and per sale, on several ad accounts:
 * spend read from every connected account with its own token, money never
 * added across currencies, one account can be chosen, and when Meta cannot
 * be reached the saved daily copy is used.
 */

const h = vi.hoisted(() => ({
  accounts: [] as Array<{ ad_account_id: string; connection_id: string; currency: string | null }>,
  saved: [] as Array<Record<string, unknown>>,
  failAll: false,
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaAdsConfig: { findUnique: async () => null },
    adCatalog: { upsert: async () => ({}) },
    metaAdAccount: { findMany: async () => h.accounts },
    metaAssetConnection: { findMany: async () => [{ id: 'c1', access_token: 'enc:TOK1' }, { id: 'c2', access_token: 'enc:TOK2' }] },
    $queryRaw: async () => h.saved,
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc:/, '') }))

import { assemble, clearSpendCache, spendByAd, type SpendResult } from './performance'

const A = '120000000000001'
const B = '120000000000002'

beforeEach(() => {
  clearSpendCache(); h.saved = []; h.failAll = false
  h.accounts = [{ ad_account_id: '111', connection_id: 'c1', currency: 'INR' }, { ad_account_id: '222', connection_id: 'c2', currency: 'INR' }]
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit) => {
    if (h.failAll) return new Response('{}', { status: 500 })
    const auth = (init.headers as Record<string, string>).Authorization
    const acct = /act_(\d+)/.exec(u)?.[1]
    const adId = acct === '111' ? A : B
    const currency = acct === '222' && h.accounts[1].currency === 'USD' ? 'USD' : 'INR'
    return Response.json({ data: [{ ad_id: adId, spend: acct === '111' ? '1000' : '500', clicks: '10', account_currency: currency, auth }] })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('spend from several ad accounts', () => {
  it('each account is read with its own token and the rows are merged', async () => {
    const r = await spendByAd('acc', '2026-11-01', '2026-11-08')
    expect(r).toMatchObject({ status: 'ok', currency: 'INR' })
    if (r.status !== 'ok') throw new Error('not ok')
    expect(r.rows.map((x) => [x.adId, x.adAccountId, x.spend])).toEqual([[A, '111', 1000], [B, '222', 500]])
    const calls = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls
    // One insights read per account (the ad-status lookups are extra calls).
    const insights = calls.filter(([u]) => u.includes('/insights'))
    expect(insights.map(([u, i]) => [/act_(\d+)/.exec(u)?.[1], (i.headers as Record<string, string>).Authorization]).sort()).toEqual([['111', 'Bearer TOK1'], ['222', 'Bearer TOK2']])
    // No token ever travels in a URL, on any call.
    for (const [u] of calls) expect(u).not.toContain('TOK')
  })

  it('accounts in different currencies: no shared currency, and totals are not added up', async () => {
    h.accounts[1].currency = 'USD'
    const r = await spendByAd('acc', '2026-11-01', '2026-11-08')
    expect(r).toMatchObject({ status: 'ok', currency: null })
    const p = assemble({ leads: [{ ad_id: A, leads: 10, won: 1, lost: 0, qualified: 4 }, { ad_id: B, leads: 5, won: 0, lost: 0, qualified: 1 }], revenue: [], touches: [], catalog: [], spend: r, otherLeads: 0 })
    expect(p.totals.spend).toBeNull()
    expect(p.spendMessage).toMatch(/different currencies/)
    expect(p.ads.find((a) => a.adId === B)).toMatchObject({ currency: 'USD', spend: 500, costPerLead: 100 })
  })

  it('Meta unreachable: the saved daily copy is shown, with a note', async () => {
    h.failAll = true
    h.saved = [{ ad_account_id: '111', ad_id: A, spend: 900, clicks: BigInt(9), currency: 'INR' }]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await spendByAd('acc', '2026-11-01', '2026-11-08')
    expect(r).toMatchObject({ status: 'ok', note: expect.stringMatching(/saved/) })
    if (r.status === 'ok') expect(r.rows[0]).toMatchObject({ adId: A, spend: 900 })
  })
})

describe('cost per qualified lead and per sale', () => {
  const spend: SpendResult = { status: 'ok', currency: 'INR', rows: [
    { adId: A, adName: 'A', adsetId: null, adsetName: null, campaignId: '9', campaignName: 'C', spend: 1000, clicks: 10, adAccountId: '111', currency: 'INR' },
    { adId: B, adName: 'B', adsetId: null, adsetName: null, campaignId: '9', campaignName: 'C', spend: 500, clicks: 5, adAccountId: '222', currency: 'INR' },
  ] }

  it('per ad, per campaign and in total', () => {
    const p = assemble({ leads: [{ ad_id: A, leads: 20, won: 2, lost: 3, qualified: 8 }, { ad_id: B, leads: 5, won: 0, lost: 1, qualified: 0 }], revenue: [], touches: [], catalog: [], spend, otherLeads: 0 })
    expect(p.ads.find((a) => a.adId === A)).toMatchObject({ qualified: 8, costPerLead: 50, costPerQualified: 125, costPerSale: 500 })
    expect(p.ads.find((a) => a.adId === B)).toMatchObject({ costPerQualified: null, costPerSale: null })
    expect(p.campaigns[0]).toMatchObject({ qualified: 8, costPerQualified: 187.5, costPerSale: 750 })
    expect(p.totals).toMatchObject({ qualified: 8, won: 2, costPerQualified: 187.5, costPerSale: 750 })
  })

  it('one ad account chosen: only its ads', () => {
    const p = assemble({ leads: [{ ad_id: A, leads: 20, won: 2, lost: 3, qualified: 8 }, { ad_id: B, leads: 5, won: 0, lost: 1 }], revenue: [], touches: [], catalog: [], spend, otherLeads: 0, onlyAds: new Set([B]) })
    expect(p.ads.map((a) => a.adId)).toEqual([B])
    expect(p.totals.spend).toBe(500)
  })
})
