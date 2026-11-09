import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reading the Spending report's rows.
 *
 * What must hold: every query is for the business asked about and no other;
 * days are cut in the business's zone; a part that cannot be read (a server
 * without migration 159, Meta not answering) leaves a warning and an empty
 * part, never a crash and never a made-up zero presented as fact.
 */

const h = vi.hoisted(() => ({
  queries: [] as Array<{ text: string; values: unknown[] }>,
  failTable: null as null | string,
  teamsFail: false,
  adsError: false,
  waRows: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }))
vi.mock('@/lib/ai/currency', () => ({ usdToInrRate: () => 88.5 }))
vi.mock('@/lib/meta-ads/api', () => ({
  fetchAdAccountInsights: () =>
    h.adsError
      ? Promise.reject(new Error('Meta says: (#190) token details SECRET'))
      : Promise.resolve({ spend: 10, impressions: 5, clicks: 2, currency: 'INR' }),
}))

vi.mock('@/lib/db', () => {
  const run = (first: any, ...vals: unknown[]) => {
    const text = Array.isArray(first) ? first.join('?') : String(first.sql ?? first.text)
    const values = Array.isArray(first) ? vals : (first.values ?? [])
    h.queries.push({ text, values })
    if (/pg_timezone_names/.test(text)) return Promise.resolve([{ ok: 1 }])
    if (h.failTable && text.includes(h.failTable)) return Promise.reject(new Error(`relation "${h.failTable}" does not exist`))
    if (text.includes('whatsapp_message_costs') && text.includes('GROUP BY 1, 2, 3') && text.includes('pricing_category')) {
      return Promise.resolve(h.waRows)
    }
    if (text.includes('count(*) AS n FROM whatsapp_message_costs')) return Promise.resolve([{ n: 0 }])
    return Promise.resolve([])
  }
  return {
    prisma: {
      $queryRaw: run,
      account: { findUnique: () => Promise.resolve({ default_currency: 'INR' }) },
      profile: { findMany: () => Promise.resolve([{ user_id: 'u1', full_name: 'Asha', email: 'asha@x.com' }]) },
      whatsAppConfig: { findMany: () => Promise.resolve([{ id: 'n1', label: 'Admissions' }]) },
      memberTeam: {
        findMany: () => (h.teamsFail ? Promise.reject(new Error('relation "member_teams" does not exist')) : Promise.resolve([{ user_id: 'u1', team: 'Sales' }])),
      },
      metaAdsConfig: {
        findUnique: () => Promise.resolve({ status: 'connected', ad_account_id: 'act_1', access_token: 'enc' }),
      },
      lead: { count: () => Promise.resolve(4) },
      deal: { count: () => Promise.resolve(1) },
    },
  }
})

import { loadSpending } from './spending'

const period = {
  kind: 'month' as const,
  from: new Date('2026-10-31T18:30:00Z'),
  to: new Date('2026-11-09T10:00:00Z'),
  prevFrom: new Date(), prevTo: new Date(),
  firstDay: '2026-11-01', lastDay: '2026-11-09', partial: true,
}

beforeEach(() => {
  h.queries = []
  h.failTable = null
  h.teamsFail = false
  h.adsError = false
  h.waRows = []
})

describe('loadSpending', () => {
  it('asks only for this business, in every cost query', async () => {
    await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    const costQueries = h.queries.filter((q) => /whatsapp_message_costs|ai_usage_events/.test(q.text))
    expect(costQueries.length).toBeGreaterThanOrEqual(8)
    for (const q of costQueries) {
      expect(q.text).toMatch(/account_id = /)
      expect(q.values).toContain('acc-1')
    }
  })

  it('leaves out a message that failed before delivery, and counts only delivered ones', async () => {
    await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    const wa = h.queries.filter((q) => q.text.includes('whatsapp_message_costs') && q.text.includes('GROUP BY'))
    for (const q of wa) {
      expect(q.text).toMatch(/voided_at IS NULL/)
      expect(q.text).toMatch(/delivered_at IS NOT NULL/)
    }
  })

  it('cuts days in the business zone', async () => {
    await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    const dayQueries = h.queries.filter((q) => /date_trunc\('day'/.test(q.text))
    expect(dayQueries.length).toBe(2)
    for (const q of dayQueries) expect(q.text).toMatch(/AT TIME ZONE/)
  })

  it('turns the rows into a report with names, teams and the number\'s label', async () => {
    h.waRows = [{ category: 'marketing', type: 'regular', currency: 'INR', n: 3, amount: '2.5893', unpriced: 0 }]
    const r = await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    expect(r.whatsapp.delivered).toBe(3)
    expect(r.whatsapp.total).toEqual({ INR: 2.5893 })
    expect(r.ads).toMatchObject({ connected: true, spend: 10, currency: 'INR' })
    expect(r.outcomes).toMatchObject({ leads: 4, wonDeals: 1 })
    expect(r.warnings).toEqual([])
  })

  it('still answers when the WhatsApp costs table is not on this server yet, with a warning', async () => {
    h.failTable = 'whatsapp_message_costs'
    const r = await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    expect(r.whatsapp.delivered).toBe(0)
    expect(r.warnings.join(' ')).toMatch(/WhatsApp message costs are not available/)
  })

  it('still answers when the teams table is not there', async () => {
    h.teamsFail = true
    const r = await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    expect(r.byTeam).toEqual([])
  })

  it('reports an ad spend it could not read without leaking Meta\'s own error text', async () => {
    h.adsError = true
    const r = await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    expect(r.ads.spend).toBeNull()
    expect(r.ads.error).toBeTruthy()
    expect(JSON.stringify(r)).not.toContain('SECRET')
  })

  it('says how many messages are unpriced and why', async () => {
    h.waRows = [{ category: 'marketing', type: 'regular', currency: null, n: 5, amount: '0', unpriced: 5 }]
    const r = await loadSpending({ accountId: 'acc-1', period, tz: 'Asia/Kolkata' })
    expect(r.whatsapp.unpriced).toBe(5)
    expect(r.warnings.join(' ')).toMatch(/5 messages have no price/)
  })
})
