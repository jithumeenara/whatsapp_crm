import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Social insights: the follower snapshot is taken once per BUSINESS day (not
 * the server clock's), numbers only; a metric Meta refuses drops out instead
 * of failing the rest; only Meta's own hosts are followed from a "next" link.
 */

const h = vi.hoisted(() => ({
  zone: 'Asia/Kolkata',
  haveToday: false,
  inserts: [] as unknown[][],
  refused: new Set<string>(),
  fetched: [] as string[],
}))

vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => h.zone }))
vi.mock('@/lib/whatsapp/encryption', () => ({ openStoredSecret: (v: string | null) => v }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('FROM instagram_config WHERE status')) return [{ account_id: 'acc-1' }]
      if (sql.includes('FROM facebook_config WHERE status')) return []
      if (sql.includes('FROM social_account_snapshots WHERE account_id')) return h.haveToday ? [{ n: 1 }] : []
      if (sql.includes('FROM instagram_config WHERE account_id')) return [{ access_token: 'EAAsys', node: '17841400000000' }]
      return []
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('INSERT INTO social_account_snapshots')) { h.inserts.push(values); return 1 }
      return 0
    },
  },
}))

import { accountTotals, clearInsightCache, insightAuth, localDay, safeGraphUrl, takeFollowerSnapshots } from './social-insights'

beforeEach(() => {
  h.zone = 'Asia/Kolkata'; h.haveToday = false; h.inserts = []; h.refused = new Set(); h.fetched = []
  clearInsightCache()
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    h.fetched.push(u)
    const url = new URL(u)
    const metric = url.searchParams.get('metric')
    if (metric && h.refused.has(metric)) return new Response(JSON.stringify({ error: { code: 100, message: 'metric retired' } }), { status: 400 })
    if (metric) return new Response(JSON.stringify({ data: [{ name: metric, total_value: { value: 10 } }] }), { status: 200 })
    return new Response(JSON.stringify({ followers_count: 1234, follows_count: 50, media_count: 80 }), { status: 200 })
  }))
})

describe('business day', () => {
  it('a moment late at night UTC is already the next day in Kolkata', () => {
    const at = new Date('2026-11-21T20:00:00Z') // 01:30 on 22 Nov in Kolkata
    expect(localDay(at, 'Asia/Kolkata')).toBe('2026-11-22')
    expect(localDay(at, 'UTC')).toBe('2026-11-21')
  })
})

describe('follower snapshot', () => {
  it("writes today's count once, on the business's date", async () => {
    expect(await takeFollowerSnapshots(new Date('2026-11-21T20:00:00Z'))).toBe(1)
    expect(h.inserts[0]).toEqual(['acc-1', 'instagram', '2026-11-22', 1234, 50, 80])
    h.haveToday = true
    h.inserts = []
    expect(await takeFollowerSnapshots(new Date('2026-11-21T20:00:00Z'))).toBe(0)
    expect(h.inserts).toEqual([])
  })
})

describe('account totals', () => {
  it('a metric Meta refuses is left out; the rest still come back; asked once per 10 minutes', async () => {
    h.refused.add('views')
    const auth = await insightAuth('acc-1', 'instagram')
    const t = await accountTotals('acc-1', 'instagram', auth!, 7)
    expect(t.reach).toBe(10)
    expect(t.views).toBeUndefined()
    const calls = h.fetched.length
    await accountTotals('acc-1', 'instagram', auth!, 7)
    expect(h.fetched.length).toBe(calls)
  })
})

describe('next-page links', () => {
  it('only https graph.facebook.com / graph.instagram.com', () => {
    expect(safeGraphUrl('https://graph.facebook.com/v27.0/1/media?after=x')).not.toBeNull()
    for (const bad of ['http://graph.facebook.com/x', 'https://graph.facebook.com.evil.example/x', 'https://169.254.169.254/latest', 'https://u:p@graph.facebook.com/x', 'https://graph.facebook.com:8443/x', 42]) {
      expect(safeGraphUrl(bad)).toBeNull()
    }
  })
})
