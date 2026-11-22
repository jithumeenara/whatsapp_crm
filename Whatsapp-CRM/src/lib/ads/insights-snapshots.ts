/**
 * Our own daily copy of ad spend (ad_insights_daily, migration 192).
 *
 * Meta deletes detailed insights after a while and has removed attribution
 * windows without notice, so every few hours the last 7 days of each
 * connected ad account are copied, one row per ad and day, with the
 * attribution setting saved beside the numbers. Reports fall back to this
 * copy when Meta cannot be reached.
 *
 * Token in the Authorization header, ids validated, only Meta's own paging
 * links followed. Free of next/server (runs in the server.ts job).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { MARKETING_API_BASE } from '@/lib/meta/versions'
import { spendAccounts, type SpendAccount, type SpendRow } from './performance'

const GRAPH = MARKETING_API_BASE
const DAY = /^\d{4}-\d{2}-\d{2}$/

async function copyAccount(accountId: string, acct: SpendAccount): Promise<number> {
  const fields = 'ad_id,spend,impressions,clicks,date_start,account_currency'
  let next: string | null = `${GRAPH}/act_${acct.adAccountId}/insights?level=ad&time_increment=1&date_preset=last_7d&limit=500&fields=${fields}`
  let saved = 0
  for (let page = 0; next && page < 20; page++) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${acct.token}` }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      console.warn('[ad-snapshots] Meta refused insights:', res.status, (await res.text().catch(() => '')).slice(0, 200))
      await prisma.metaAdAccount.updateMany({ where: { account_id: accountId, ad_account_id: acct.adAccountId }, data: { last_error: 'Could not read spend from Meta — press Check.' } })
      return saved
    }
    const body = (await res.json()) as { data?: Array<Record<string, string>>; paging?: { next?: string } }
    for (const r of body.data ?? []) {
      if (!/^\d{1,30}$/.test(r.ad_id ?? '') || !DAY.test(r.date_start ?? '')) continue
      const day = new Date(`${r.date_start}T00:00:00Z`)
      const data = {
        spend: new Prisma.Decimal(Number(r.spend ?? 0) || 0),
        impressions: BigInt(Math.max(0, Math.floor(Number(r.impressions ?? 0) || 0))),
        clicks: BigInt(Math.max(0, Math.floor(Number(r.clicks ?? 0) || 0))),
        currency: /^[A-Z]{3}$/.test(r.account_currency ?? '') ? r.account_currency : acct.currency,
        attribution: 'meta_default',
        fetched_at: new Date(),
      }
      await prisma.adInsightDaily.upsert({
        where: { account_id_ad_account_id_ad_id_day: { account_id: accountId, ad_account_id: acct.adAccountId, ad_id: r.ad_id, day } },
        create: { account_id: accountId, ad_account_id: acct.adAccountId, ad_id: r.ad_id, day, ...data },
        update: data,
      })
      saved++
    }
    next = body.paging?.next && body.paging.next.startsWith(`${GRAPH}/`) ? body.paging.next : null
  }
  await prisma.metaAdAccount.updateMany({ where: { account_id: accountId, ad_account_id: acct.adAccountId }, data: { last_synced_at: new Date() } })
  return saved
}

/** Job: copy the last 7 days for every workspace with connected ad accounts. */
export async function snapshotAdInsights(): Promise<number> {
  const workspaces = await prisma.metaAdAccount.findMany({ distinct: ['account_id'], select: { account_id: true }, take: 500 })
  let total = 0
  for (const w of workspaces) {
    const accounts = await spendAccounts(w.account_id).catch(() => [])
    for (const a of accounts) {
      try { total += await copyAccount(w.account_id, a) } catch (err) {
        console.error('[ad-snapshots] copy failed:', err instanceof Error ? err.message : err)
      }
    }
  }
  return total
}

/** Saved spend per ad for a period (used when Meta cannot be reached). */
export async function savedSpend(accountId: string, since: string, until: string): Promise<{ rows: SpendRow[]; currency: string | null } | null> {
  if (!DAY.test(since) || !DAY.test(until)) return null
  const rows = await prisma.$queryRaw<Array<{ ad_account_id: string; ad_id: string; spend: Prisma.Decimal | number; clicks: bigint; currency: string | null }>>`
    SELECT ad_account_id, ad_id, sum(spend) AS spend, sum(clicks) AS clicks, max(currency) AS currency
    FROM ad_insights_daily
    WHERE account_id = ${accountId}::uuid AND day >= ${since}::date AND day <= ${until}::date
    GROUP BY ad_account_id, ad_id`
  if (rows.length === 0) return null
  const currencies = [...new Set(rows.map((r) => r.currency).filter((c): c is string => Boolean(c)))]
  return {
    currency: currencies.length === 1 ? currencies[0] : null,
    rows: rows.map((r) => ({
      adId: r.ad_id, adName: null, adsetId: null, adsetName: null, campaignId: null, campaignName: null,
      spend: Number(r.spend) || 0, clicks: Number(r.clicks) || 0, adAccountId: r.ad_account_id, currency: r.currency,
    })),
  }
}
