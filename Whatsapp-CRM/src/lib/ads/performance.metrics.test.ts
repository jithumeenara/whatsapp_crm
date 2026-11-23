import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every ad and campaign shows Impressions, Clicks, CTR, CPC, CPM, reach,
 * Meta's delivery status and Meta's own events (chats started, leads, link
 * clicks …) in plain names.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    metaAdsConfig: { findUnique: async () => null },
    adCatalog: { upsert: async () => ({}) },
    metaAdAccount: { findMany: async () => [{ ad_account_id: '111', connection_id: 'c1', currency: 'INR' }] },
    metaAssetConnection: { findMany: async () => [{ id: 'c1', access_token: 'enc:TOK' }] },
    $queryRaw: async () => [],
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc:/, '') }))

import { assemble, clearSpendCache, readEvents, spendByAd } from './performance'

const A = '120000000000001'
const B = '120000000000002'

describe('Meta events in plain names', () => {
  it('known types get plain names; unknown ones a readable form; junk is dropped', () => {
    expect(readEvents([
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12' },
      { action_type: 'link_click', value: '30' },
      { action_type: 'offsite_conversion.fb_pixel_custom', value: '2' },
      { action_type: '<script>', value: '9' },
      { action_type: 'lead', value: '-3' },
      { action_type: 'video_view', value: 'abc' },
    ])).toEqual({ 'Chats started': 12, 'Link clicks': 30, Custom: 2 })
    expect(readEvents('not a list')).toEqual({})
  })
})

describe('delivery numbers per ad, campaign and total', () => {
  beforeEach(() => {
    clearSpendCache()
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.includes('/ads?')) return Response.json({ data: [{ id: A, effective_status: 'ACTIVE' }, { id: B, effective_status: 'PAUSED' }] })
      return Response.json({ data: [
        { ad_id: A, campaign_id: '9', campaign_name: 'C', spend: '1000', clicks: '50', impressions: '10000', reach: '7000', inline_link_clicks: '40', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '20' }], account_currency: 'INR' },
        { ad_id: B, campaign_id: '9', campaign_name: 'C', spend: '500', clicks: '10', impressions: '5000', reach: '4000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '5' }, { action_type: 'link_click', value: '8' }], account_currency: 'INR' },
      ] })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('CTR, CPC, CPM, reach, status and events — summed for the campaign and the total', async () => {
    const spend = await spendByAd('acc', '2026-11-01', '2026-11-08')
    const p = assemble({ leads: [], revenue: [], touches: [], catalog: [], spend, otherLeads: 0 })
    expect(p.ads.find((a) => a.adId === A)).toMatchObject({ impressions: 10000, clicks: 50, reach: 7000, ctr: 0.5, cpc: 20, cpm: 100, status: 'ACTIVE', events: { 'Chats started': 20 } })
    expect(p.ads.find((a) => a.adId === B)).toMatchObject({ status: 'PAUSED', cpc: 50 })
    expect(p.campaigns[0]).toMatchObject({ impressions: 15000, clicks: 60, ctr: 0.4, cpc: 25, cpm: 100, events: { 'Chats started': 25, 'Link clicks': 8 } })
    expect(p.totals).toMatchObject({ impressions: 15000, clicks: 60, ctr: 0.4, cpc: 25, cpm: 100 })
    const statusCall = (fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls.find(([u]) => u.includes('/ads?'))
    expect(statusCall?.[0]).toContain('/act_111/ads?fields=id,effective_status')
    expect((statusCall?.[1].headers as Record<string, string>).Authorization).toBe('Bearer TOK')
  })
})
