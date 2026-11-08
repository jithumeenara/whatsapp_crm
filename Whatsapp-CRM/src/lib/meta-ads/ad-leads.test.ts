import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  config: { status: 'connected', ad_account_id: 'act_1', access_token: 'enc' } as null | Record<string, unknown>,
  insights: { spend: 3000, impressions: 1000, clicks: 50, cpc: 60, cpm: 3000, date_start: '2026-11-01', date_stop: '2026-11-08', currency: 'INR' } as null | Record<string, unknown>,
  insightsFail: false,
  insightsArgs: [] as unknown[],
  wheres: [] as Array<{ model: string; where: Record<string, unknown> }>,
  form: 4,
  ctwa: 2,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }))
vi.mock('@/lib/meta-ads/api', () => ({
  fetchAdAccountInsights: async (a: unknown) => {
    h.insightsArgs.push(a)
    if (h.insightsFail) throw new Error('Meta said: (#100) raw library text')
    return h.insights
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaAdsConfig: { findUnique: async () => h.config },
    leadAdSubmission: { count: async ({ where }: { where: Record<string, unknown> }) => { h.wheres.push({ model: 'form', where }); return h.form } },
    lead: { count: async ({ where }: { where: Record<string, unknown> }) => { h.wheres.push({ model: 'lead', where }); return h.ctwa } },
  },
}))

import { countAdLeads, loadMetaAdsPeriod } from './ad-leads'

const win = { since: '2026-11-01', until: '2026-11-08', start: new Date('2026-10-31T18:30:00Z'), end: new Date('2026-11-08T18:30:00Z') }

beforeEach(() => {
  h.config = { status: 'connected', ad_account_id: 'act_1', access_token: 'enc' }
  h.insights = { spend: 3000, impressions: 1000, clicks: 50, cpc: 60, cpm: 3000, date_start: '2026-11-01', date_stop: '2026-11-08', currency: 'INR' }
  h.insightsFail = false
  h.insightsArgs = []
  h.wheres = []
  h.form = 4
  h.ctwa = 2
})

describe('countAdLeads', () => {
  it('counts form leads and click-to-WhatsApp leads in the same window, in this account, without counting one twice', async () => {
    const n = await countAdLeads('acc', win.start, win.end)
    expect(n).toEqual({ form: 4, clickToWhatsApp: 2, total: 6 })
    for (const w of h.wheres) {
      expect(w.where.account_id).toBe('acc')
      expect(w.where.created_at).toEqual({ gte: win.start, lt: win.end })
    }
    const lead = h.wheres.find((w) => w.model === 'lead')!.where
    expect(lead.lead_ad_submissions).toEqual({ none: {} })
    expect(JSON.stringify(lead)).toContain('ctwa_clid')
  })
})

describe('loadMetaAdsPeriod', () => {
  it('spend for exactly the asked days, divided by the ad leads of those days', async () => {
    const r = await loadMetaAdsPeriod({ accountId: 'acc', ...win })
    expect(h.insightsArgs[0]).toMatchObject({ adAccountId: 'act_1', accessToken: 'token', timeRange: { since: '2026-11-01', until: '2026-11-08' } })
    expect(r).toEqual({
      connected: true, spend: 3000, currency: 'INR', clicks: 50, impressions: 1000,
      leads: { form: 4, clickToWhatsApp: 2, total: 6 }, costPerLead: 500, error: null, needsAdAccount: false,
    })
  })

  it('says not connected rather than showing zeros', async () => {
    h.config = null
    expect(await loadMetaAdsPeriod({ accountId: 'acc', ...win })).toEqual({ connected: false })
  })

  it('without an ad account: leads still counted, spend unknown (null, not 0)', async () => {
    h.config = { status: 'connected', ad_account_id: null, access_token: 'enc' }
    const r = await loadMetaAdsPeriod({ accountId: 'acc', ...win })
    expect(r).toMatchObject({ connected: true, spend: null, costPerLead: null, needsAdAccount: true, leads: { total: 6 } })
  })

  it('a Meta failure gives a plain sentence, never Meta’s own text', async () => {
    h.insightsFail = true
    const r = await loadMetaAdsPeriod({ accountId: 'acc', ...win })
    expect(r).toMatchObject({ connected: true, spend: null, costPerLead: null })
    if (!r.connected) throw new Error('expected connected')
    expect(r.error).toMatch(/Could not read ad spend from Meta/)
    expect(r.error).not.toContain('#100')
  })

  it('no leads: cost per lead is unknown, not infinite', async () => {
    h.form = 0
    h.ctwa = 0
    const r = await loadMetaAdsPeriod({ accountId: 'acc', ...win })
    expect(r).toMatchObject({ spend: 3000, costPerLead: null })
  })
})
