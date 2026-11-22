import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Our own daily copy of ad spend: last 7 days per connected ad account,
 * one row per ad and day (upserted, so a re-run never duplicates), token
 * in the header, only Meta's own paging links followed, bad rows skipped.
 */

const h = vi.hoisted(() => ({ upserts: [] as Array<{ where: unknown; create: Record<string, unknown> }>, synced: 0, errors: 0 }))
vi.mock('@/lib/db', () => ({
  prisma: {
    metaAdAccount: {
      findMany: async (a: { distinct?: unknown }) => (a.distinct ? [{ account_id: 'acc-1' }] : [{ ad_account_id: '111', connection_id: 'c1', currency: 'INR' }]),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { if (data.last_synced_at) h.synced++; if (data.last_error) h.errors++; return { count: 1 } },
    },
    metaAssetConnection: { findMany: async () => [{ id: 'c1', access_token: 'enc:TOK' }] },
    adInsightDaily: { upsert: async (a: { where: unknown; create: Record<string, unknown> }) => { h.upserts.push(a); return {} } },
    metaAdsConfig: { findUnique: async () => null },
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc:/, '') }))

import { snapshotAdInsights } from './insights-snapshots'

beforeEach(() => { h.upserts = []; h.synced = 0; h.errors = 0 })

describe('daily ad-spend copy', () => {
  it('copies each ad and day, skips bad rows, never follows a foreign paging link', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      data: [
        { ad_id: '120000000000001', date_start: '2026-11-20', spend: '250.50', impressions: '1000', clicks: '30', account_currency: 'INR' },
        { ad_id: 'x', date_start: '2026-11-20', spend: '1' },
        { ad_id: '120000000000001', date_start: 'not-a-day', spend: '1' },
      ],
      paging: { next: 'https://evil.example/next' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const n = await snapshotAdInsights()
    expect(n).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/act_111/insights?level=ad&time_increment=1&date_preset=last_7d')
    expect(url).not.toContain('TOK')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK')
    expect(h.upserts[0].create).toMatchObject({ account_id: 'acc-1', ad_account_id: '111', ad_id: '120000000000001', currency: 'INR', attribution: 'meta_default' })
    expect(h.synced).toBe(1)
  })

  it('Meta refuses: the account shows a plain error, nothing copied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await snapshotAdInsights()).toBe(0)
    expect(h.errors).toBe(1)
  })
})
