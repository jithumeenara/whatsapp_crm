import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ config: { status: 'connected', access_token: 'enc', ad_account_id: '123456789' } as Record<string, string> | null, upserts: 0 }))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaAdsConfig: { findUnique: async () => h.config },
    adCatalog: { upsert: async () => { h.upserts++ } },
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'tok' }))

import { assemble, clearSpendCache, spendByAd, type SpendResult } from './performance'

const A = '120000000000001'
const B = '120000000000002'
const C = '120000000000003'

const spend: SpendResult = {
  status: 'ok', currency: 'INR', rows: [
    { adId: A, adName: 'Diwali offer', adsetId: '1', adsetName: 'Kerala', campaignId: '900', campaignName: 'November', spend: 5000, clicks: 400 },
    { adId: B, adName: 'Free demo', adsetId: '1', adsetName: 'Kerala', campaignId: '900', campaignName: 'November', spend: 3000, clicks: 100 },
    { adId: C, adName: 'Old banner', adsetId: '2', adsetName: 'All India', campaignId: '901', campaignName: 'Brand', spend: 2000, clicks: 50 },
  ],
}

const base = {
  leads: [
    { ad_id: A, leads: 50, won: 5, lost: 10 },
    { ad_id: B, leads: 6, won: 0, lost: 1 },
  ],
  revenue: [{ ad_id: A, currency: 'INR', amount: 40000 }],
  touches: [{ ad_id: A, arrivals: 80, channels: ['whatsapp', 'instagram'], headline: 'Diwali 50% off' }],
  catalog: [],
  spend,
  otherLeads: 30,
}

describe('assemble', () => {
  it('joins click, lead, win and money per ad, with cost per lead and return on spend', () => {
    const p = assemble(base)
    const a = p.ads.find((x) => x.adId === A)
    expect(a).toMatchObject({ adName: 'Diwali offer', campaignName: 'November', arrivals: 80, leads: 50, won: 5, spend: 5000, costPerLead: 100, roas: 8, channels: ['whatsapp', 'instagram'] })
    expect(p.totals).toMatchObject({ leads: 56, won: 5, spend: 10000, roas: 4 })
    expect(p.otherLeads).toBe(30)
  })

  it('an ad that spent and brought nobody is listed, and called out first', () => {
    const p = assemble(base)
    expect(p.ads.find((x) => x.adId === C)).toMatchObject({ leads: 0, spend: 2000, costPerLead: null })
    expect(p.findings[0]).toBe('"Old banner" spent ₹2,000 and brought no leads.')
  })

  it('compares the cheapest and dearest lead when the gap is big', () => {
    const p = assemble(base)
    expect(p.findings).toContain('"Diwali offer" gets leads at ₹100 each; "Free demo" costs ₹500.')
  })

  it('rolls ads up into campaigns', () => {
    const p = assemble(base)
    const nov = p.campaigns.find((c) => c.campaignId === '900')
    expect(nov).toMatchObject({ ads: 2, leads: 56, spend: 8000, costPerLead: 142.86, roas: 5 })
  })

  it('no ad account: spend is unknown (null), never zero, and leads still show', () => {
    const p = assemble({ ...base, spend: { status: 'not_connected', message: 'Connect…' } })
    expect(p.totals.spend).toBeNull()
    expect(p.ads.find((x) => x.adId === A)).toMatchObject({ spend: null, costPerLead: null, roas: null, leads: 50 })
    expect(p.ads.some((x) => x.adId === C)).toBe(false)
    expect(p.spendMessage).toBe('Connect…')
  })

  it('revenue in another currency is shown but not divided by spend', () => {
    const p = assemble({ ...base, revenue: [{ ad_id: A, currency: 'USD', amount: 500 }] })
    expect(p.ads.find((x) => x.adId === A)).toMatchObject({ roas: null, revenue: [{ currency: 'USD', amount: 500 }] })
  })

  it('nothing at all: empty lists, no findings, no crash', () => {
    const p = assemble({ leads: [], revenue: [], touches: [], catalog: [], spend: { status: 'ok', currency: null, rows: [] }, otherLeads: 0 })
    expect(p.ads).toEqual([])
    expect(p.findings).toEqual([])
    expect(p.totals.costPerLead).toBeNull()
  })
})

describe('spendByAd', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    clearSpendCache()
    h.config = { status: 'connected', access_token: 'enc', ad_account_id: '123456789' }
    fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ ad_id: A, ad_name: 'Diwali offer', campaign_id: '900', campaign_name: 'November', spend: '5000.50', clicks: '400', account_currency: 'INR' }],
      paging: { next: 'https://evil.example/steal' },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads ad-level spend once per 5 minutes, token in a header, never follows a foreign paging link', async () => {
    const r = await spendByAd('acc', '2026-11-01', '2026-11-08')
    expect(r).toMatchObject({ status: 'ok', currency: 'INR', rows: [{ adId: A, spend: 5000.5, clicks: 400 }] })
    await spendByAd('acc', '2026-11-01', '2026-11-08')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [u, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(u).toContain('/act_123456789/insights?level=ad')
    expect(u).not.toContain('tok')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('says plainly why spend is missing', async () => {
    h.config = null
    expect((await spendByAd('acc', '2026-11-01', '2026-11-08')).status).toBe('not_connected')
    clearSpendCache()
    h.config = { status: 'connected', access_token: 'enc', ad_account_id: '' }
    expect((await spendByAd('acc', '2026-11-01', '2026-11-08')).status).toBe('no_ad_account')
    clearSpendCache()
    h.config = { status: 'connected', access_token: 'enc', ad_account_id: '123456789' }
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await spendByAd('acc', '2026-11-01', '2026-11-08')).toMatchObject({ status: 'error' })
  })
})
