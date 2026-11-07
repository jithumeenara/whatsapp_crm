import { beforeEach, describe, expect, it, vi } from 'vitest'

// Bug: cost per lead divided the LAST 30 DAYS of ad spend by EVERY lead
// form submission ever received, and left click-to-WhatsApp leads out
// altogether. The longer an account ran, the cheaper its leads looked.
// Spend and leads must cover the same days (in the business's zone), and
// the response must say which leads were counted.

const h = vi.hoisted(() => ({
  insightsArgs: [] as unknown[],
  calls: [] as Array<{ model: string; method: string; where: any }>,
  spend: 3000,
  formAllTime: 10,
  formInWindow: 2,
  ctwaInWindow: 1,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: 'admin' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }))
vi.mock('@/lib/meta-ads/api', () => ({
  fetchAdAccountInsights: (args: unknown) => {
    h.insightsArgs.push(args)
    return Promise.resolve({
      spend: h.spend,
      impressions: 1000,
      clicks: 50,
      cpc: 60,
      cpm: 3000,
      date_start: '2026-10-10',
      date_stop: '2026-11-08',
    })
  },
}))

const isCtwaLead = (where: any) => JSON.stringify(where ?? {}).includes('ctwa_clid')

vi.mock('@/lib/db', () => ({
  prisma: {
    companyProfile: { findFirst: () => Promise.resolve({ timezone: 'Asia/Kolkata' }) },
    metaAdsConfig: {
      findUnique: () =>
        Promise.resolve({ status: 'connected', ad_account_id: 'act_1', access_token: 'enc', dataset_id: null }),
    },
    conversation: {
      count: ({ where }: any) => {
        h.calls.push({ model: 'conversation', method: 'count', where })
        return Promise.resolve(7)
      },
    },
    leadAdSubmission: {
      count: ({ where }: any) => {
        h.calls.push({ model: 'leadAdSubmission', method: 'count', where })
        return Promise.resolve(where?.created_at ? h.formInWindow : h.formAllTime)
      },
      findMany: () => Promise.resolve([]),
    },
    lead: {
      count: ({ where }: any) => {
        h.calls.push({ model: 'lead', method: 'count', where })
        if (isCtwaLead(where) && where?.created_at) return Promise.resolve(h.ctwaInWindow)
        return Promise.resolve(0)
      },
    },
  },
}))

import { GET } from './route'

// 20:00 UTC on 7 Nov is already 8 Nov in Kolkata.
const NOW = new Date('2026-11-07T20:00:00Z')

beforeEach(() => {
  h.insightsArgs.length = 0
  h.calls.length = 0
  h.spend = 3000
  h.formInWindow = 2
  h.ctwaInWindow = 1
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

async function load() {
  const res = await GET()
  return (await res.json()) as Record<string, any>
}

describe('Meta ads cost per lead covers the same days on both sides', () => {
  it('divides the window spend by form and click-to-WhatsApp leads from that window', async () => {
    const body = await load()
    // 3000 spent over 2 form leads + 1 click-to-WhatsApp lead.
    expect(body.cost_per_lead).toBe(1000)
    expect(body.cost_per_lead_leads).toEqual({ form: 2, click_to_whatsapp: 1, total: 3 })
  })

  it('asks Meta for the same 30 business days the leads are counted over', async () => {
    const body = await load()
    expect(h.insightsArgs[0]).toMatchObject({ timeRange: { since: '2026-10-10', until: '2026-11-08' } })
    expect(body.cost_per_lead_window).toMatchObject({ since: '2026-10-10', until: '2026-11-08' })
    const windowed = h.calls.filter((c) => c.where?.created_at && c.model !== 'conversation')
    expect(windowed.length).toBeGreaterThanOrEqual(2)
    for (const c of windowed) {
      expect(c.where.created_at.gte.toISOString()).toBe('2026-10-09T18:30:00.000Z')
      expect(c.where.created_at.lt.toISOString()).toBe('2026-11-08T18:30:00.000Z')
    }
  })

  it('does not count a form lead twice when it also came through a click-to-WhatsApp chat', async () => {
    await load()
    const ctwa = h.calls.find((c) => c.model === 'lead' && isCtwaLead(c.where) && c.where?.created_at)
    expect(ctwa?.where.lead_ad_submissions).toEqual({ none: {} })
  })

  it('returns no cost per lead, not infinity, when the window has no leads', async () => {
    h.formInWindow = 0
    h.ctwaInWindow = 0
    const body = await load()
    expect(body.cost_per_lead).toBeNull()
    expect(body.cost_per_lead_leads).toEqual({ form: 0, click_to_whatsapp: 0, total: 0 })
  })

  it('keeps the fields the Ads page already reads', async () => {
    const body = await load()
    expect(body).toMatchObject({
      connected: true,
      attributed_conversations: 7,
      lead_ads_captured: 10,
      qualified_from_ads: 0,
      recent_leads: [],
    })
    expect(body.insights.spend).toBe(3000)
  })
})
