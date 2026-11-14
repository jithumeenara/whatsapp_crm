/**
 * The ad account's own numbers from Meta for a run of days: spend, reach,
 * impressions, clicks and frequency for the whole run, and spend by day.
 * What the "week at a glance" page of a presentation is made of.
 *
 * Reach is not additive (one person seen on two days is one person), so
 * the whole-period figures come from one call and the days from another
 * (time_increment=1). Cached 5 minutes per account and days; a token that
 * is missing, unreadable or refused is a plain status, never an error.
 * The ad account's time zone is Meta's; days are Meta's days.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const GRAPH = 'https://graph.facebook.com/v21.0'
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CACHE_MS = 5 * 60_000

export interface InsightTotals {
  spend: number
  reach: number
  impressions: number
  clicks: number
  frequency: number | null
  currency: string | null
}

export type AccountInsights =
  | { status: 'ok'; totals: InsightTotals; byDay: Array<{ day: string; spend: number; clicks: number }> }
  | { status: 'not_connected' | 'no_ad_account' | 'error'; message: string }

const cache = new Map<string, { at: number; value: AccountInsights }>()
export function clearInsightsCache() { cache.clear() }

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** One Meta insights row → totals. Pure. */
export function totalsFromRow(row: Record<string, unknown> | undefined): InsightTotals {
  const currency = typeof row?.account_currency === 'string' && /^[A-Z]{3}$/.test(row.account_currency) ? row.account_currency : null
  return {
    spend: num(row?.spend),
    reach: num(row?.reach),
    impressions: num(row?.impressions),
    clicks: num(row?.clicks),
    frequency: row?.frequency != null && Number.isFinite(Number(row.frequency)) ? Math.round(Number(row.frequency) * 100) / 100 : null,
    currency,
  }
}

async function graph(url: string, token: string): Promise<Array<Record<string, unknown>> | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) {
    console.error('[ads] Meta refused account insights:', res.status, (await res.text().catch(() => '')).slice(0, 200))
    return null
  }
  const body = (await res.json()) as { data?: Array<Record<string, unknown>> }
  return body.data ?? []
}

export async function accountInsights(accountId: string, since: string, until: string): Promise<AccountInsights> {
  if (!DAY.test(since) || !DAY.test(until)) return { status: 'error', message: 'The dates could not be read.' }
  const key = `${accountId}|${since}|${until}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const value = await read(accountId, since, until)
  cache.set(key, { at: Date.now(), value })
  while (cache.size > 200) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return value
}

async function read(accountId: string, since: string, until: string): Promise<AccountInsights> {
  const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId }, select: { status: true, access_token: true, ad_account_id: true } })
  if (!config || config.status !== 'connected') return { status: 'not_connected', message: 'Connect your ad account in Settings → Ads to see ad spend and reach.' }
  const account = (config.ad_account_id ?? '').trim()
  if (!/^(act_)?\d{5,30}$/.test(account)) return { status: 'no_ad_account', message: 'Add your ad account ID in Settings → Ads to see ad spend and reach.' }
  try {
    const token = decrypt(config.access_token)
    const act = account.startsWith('act_') ? account : `act_${account}`
    const range = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`
    const [whole, days] = await Promise.all([
      graph(`${GRAPH}/${act}/insights?fields=spend,reach,impressions,clicks,frequency,account_currency&${range}`, token),
      graph(`${GRAPH}/${act}/insights?fields=spend,clicks&time_increment=1&limit=400&${range}`, token),
    ])
    if (!whole || !days) return { status: 'error', message: 'Could not read ad figures from Meta. Check the ad account and its access in Settings → Ads.' }
    return {
      status: 'ok',
      totals: totalsFromRow(whole[0]),
      byDay: days
        .filter((r) => typeof r.date_start === 'string' && DAY.test(r.date_start))
        .map((r) => ({ day: r.date_start as string, spend: num(r.spend), clicks: num(r.clicks) }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    }
  } catch (err) {
    console.error('[ads] account insights failed:', err instanceof Error ? err.message : err)
    return { status: 'error', message: 'Could not read ad figures from Meta. Check the ad account and its access in Settings → Ads.' }
  }
}
