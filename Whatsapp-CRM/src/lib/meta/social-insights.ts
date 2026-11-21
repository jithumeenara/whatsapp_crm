/**
 * Instagram account / Facebook Page numbers for the Social screen:
 *  - daily follower snapshots (Meta gives only today's count, so the
 *    history is kept here — numbers only, no personal data);
 *  - account totals for the last 7 or 30 days;
 *  - Instagram audience (age, gender, cities) — counts, never a list of
 *    people (Meta does not give follower lists to anyone).
 *
 * Each metric is asked for on its own, so a metric Meta retires drops out
 * instead of failing the whole page. Results are cached for 10 minutes per
 * workspace, so opening the screen repeatedly does not burn Meta's rate
 * limit. Imported by the server.ts sweep: no next/server here.
 */

import { prisma } from '@/lib/db'
import { businessTimezone } from '@/lib/ai/human-date'
import { openStoredSecret } from '@/lib/whatsapp/encryption'
import { GRAPH_API_VERSION } from './versions'
import { graphHost, type SocialChannel } from './social-messaging'

const NUMERIC = /^\d{1,30}$/
const DAY_MS = 86_400_000

/** The business's calendar day for a moment, "YYYY-MM-DD". */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** Only Meta's own Graph hosts are ever fetched from a "next page" link. */
export function safeGraphUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
    return u.hostname === 'graph.facebook.com' || u.hostname === 'graph.instagram.com' ? u.toString() : null
  } catch {
    return null
  }
}

export async function ensureSnapshotTable(): Promise<void> {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS social_account_snapshots (
      account_id   UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      channel      TEXT        NOT NULL CHECK (channel IN ('instagram', 'facebook')),
      day          DATE        NOT NULL,
      followers    INTEGER,
      follows      INTEGER,
      media_count  INTEGER,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, channel, day)
    )`.catch((e: unknown) => console.warn('[social insights] snapshot table not created:', e instanceof Error ? e.message : e))
}

export interface InsightAuth { token: string; nodeId: string }

/** The workspace's own token + account node for a channel (server only). */
export async function insightAuth(accountId: string, channel: SocialChannel): Promise<InsightAuth | null> {
  const rows = channel === 'instagram'
    ? await prisma.$queryRaw<{ access_token: string | null; node: string | null }[]>`
        SELECT access_token, instagram_account_id AS node FROM instagram_config WHERE account_id = ${accountId}::uuid AND status = 'connected' LIMIT 1`.catch(() => [])
    : await prisma.$queryRaw<{ access_token: string | null; node: string | null }[]>`
        SELECT access_token, page_id AS node FROM facebook_config WHERE account_id = ${accountId}::uuid AND status = 'connected' LIMIT 1`.catch(() => [])
  const row = rows[0]
  let token: string | null = null
  try { token = openStoredSecret(row?.access_token ?? null) } catch { token = null }
  if (!token || !row?.node || !NUMERIC.test(row.node)) return null
  return { token, nodeId: row.node }
}

function base(channel: SocialChannel, auth: InsightAuth): string {
  return channel === 'instagram' ? `${graphHost('instagram', auth.token)}/${auth.nodeId}` : `https://graph.facebook.com/${GRAPH_API_VERSION}/${auth.nodeId}`
}

async function getJson(url: string, token: string): Promise<Record<string, unknown> | null> {
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}access_token=${encodeURIComponent(token)}`, { cache: 'no-store' }).catch(() => null)
  if (!res) return null
  const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: { code?: number; message?: string } }) | null
  if (!res.ok || !data || data.error) {
    console.warn('[social insights] Meta refused a metric:', res.status, data?.error?.code, data?.error?.message)
    return null
  }
  return data
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

/** Today's counts for the account (followers, following, posts). */
export async function currentCounts(channel: SocialChannel, auth: InsightAuth): Promise<{ followers: number | null; follows: number | null; media: number | null }> {
  const fields = channel === 'instagram' ? 'followers_count,follows_count,media_count' : 'followers_count,fan_count'
  const d = await getJson(`${base(channel, auth)}?fields=${fields}`, auth.token)
  if (!d) return { followers: null, follows: null, media: null }
  return {
    followers: num(d.followers_count) ?? num(d.fan_count),
    follows: num(d.follows_count),
    media: num(d.media_count),
  }
}

// ── Daily snapshots (server.ts sweep) ──────────────────────────────────────

/** Once per business day per connected channel. Returns how many were written. */
export async function takeFollowerSnapshots(now = new Date()): Promise<number> {
  await ensureSnapshotTable()
  let written = 0
  for (const channel of ['instagram', 'facebook'] as const) {
    const accounts = channel === 'instagram'
      ? await prisma.$queryRaw<{ account_id: string }[]>`SELECT account_id::text AS account_id FROM instagram_config WHERE status = 'connected' AND access_token IS NOT NULL LIMIT 500`.catch(() => [])
      : await prisma.$queryRaw<{ account_id: string }[]>`SELECT account_id::text AS account_id FROM facebook_config WHERE status = 'connected' AND access_token IS NOT NULL LIMIT 500`.catch(() => [])
    for (const { account_id } of accounts) {
      const day = localDay(now, await businessTimezone(account_id))
      const have = await prisma.$queryRaw<{ n: number }[]>`
        SELECT 1 AS n FROM social_account_snapshots WHERE account_id = ${account_id}::uuid AND channel = ${channel} AND day = ${day}::date LIMIT 1`.catch(() => [])
      if (have.length > 0) continue
      const auth = await insightAuth(account_id, channel)
      if (!auth) continue
      const c = await currentCounts(channel, auth)
      if (c.followers === null) continue
      const n = await prisma.$executeRaw`
        INSERT INTO social_account_snapshots (account_id, channel, day, followers, follows, media_count)
        VALUES (${account_id}::uuid, ${channel}, ${day}::date, ${c.followers}, ${c.follows}, ${c.media})
        ON CONFLICT (account_id, channel, day) DO NOTHING`.catch(() => 0)
      written += n
    }
  }
  return written
}

/** Follower history for the chart, oldest first. */
export async function followerHistory(accountId: string, channel: SocialChannel, days: number): Promise<Array<{ day: string; followers: number }>> {
  const span = Math.min(Math.max(Math.trunc(days), 7), 365)
  const rows = await prisma.$queryRaw<{ day: string; followers: number | null }[]>`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, followers FROM social_account_snapshots
    WHERE account_id = ${accountId}::uuid AND channel = ${channel} AND day >= (CURRENT_DATE - ${span}::int)
    ORDER BY day ASC`.catch(() => [])
  return rows.filter((r) => typeof r.followers === 'number').map((r) => ({ day: r.day, followers: r.followers as number }))
}

// ── Account totals and audience (cached) ───────────────────────────────────

const CACHE_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T
  const value = await load()
  if (cache.size > 500) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), value })
  return value
}

export const IG_TOTAL_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'follows_and_unfollows'] as const
export const FB_TOTAL_METRICS = ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements', 'page_daily_follows_unique', 'page_daily_unfollows_unique'] as const

/** Totals for the last N days (7 or 30). Missing metrics are simply absent. */
export async function accountTotals(accountId: string, channel: SocialChannel, auth: InsightAuth, days: 7 | 30, now = new Date()): Promise<Record<string, number>> {
  return cached(`${accountId}:${channel}:totals:${days}`, async () => {
    const until = Math.floor(now.getTime() / 1000)
    const since = Math.floor((now.getTime() - days * DAY_MS) / 1000)
    const out: Record<string, number> = {}
    const metrics = channel === 'instagram' ? IG_TOTAL_METRICS : FB_TOTAL_METRICS
    await Promise.all(metrics.map(async (metric) => {
      const url = channel === 'instagram'
        ? `${base(channel, auth)}/insights?metric=${metric}&period=day&metric_type=total_value&since=${since}&until=${until}`
        : `${base(channel, auth)}/insights?metric=${metric}&period=day&since=${since}&until=${until}`
      const d = await getJson(url, auth.token)
      const item = Array.isArray(d?.data) ? (d.data as Array<Record<string, unknown>>)[0] : undefined
      if (!item) return
      const total = (item.total_value as { value?: unknown } | undefined)?.value
      if (num(total) !== null) { out[metric] = num(total) as number; return }
      const values = Array.isArray(item.values) ? (item.values as Array<{ value?: unknown }>) : []
      const sum = values.reduce((s, v) => s + (num(v.value) ?? 0), 0)
      if (values.length > 0) out[metric] = sum
    }))
    return out
  })
}

export type AudienceBreakdown = 'age' | 'gender' | 'city'

/** Instagram audience: counts per age band / gender / city (top 10). */
export async function instagramAudience(accountId: string, auth: InsightAuth): Promise<Record<AudienceBreakdown, Array<{ label: string; value: number }>>> {
  return cached(`${accountId}:instagram:audience`, async () => {
    const out: Record<AudienceBreakdown, Array<{ label: string; value: number }>> = { age: [], gender: [], city: [] }
    await Promise.all((['age', 'gender', 'city'] as const).map(async (breakdown) => {
      const d = await getJson(`${base('instagram', auth)}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&timeframe=this_month&breakdown=${breakdown}`, auth.token)
      const item = Array.isArray(d?.data) ? (d.data as Array<Record<string, unknown>>)[0] : undefined
      const groups = ((item?.total_value as { breakdowns?: Array<{ results?: Array<{ dimension_values?: unknown[]; value?: unknown }> }> } | undefined)?.breakdowns?.[0]?.results) ?? []
      out[breakdown] = groups
        .map((g) => ({ label: String(g.dimension_values?.[0] ?? '').slice(0, 60), value: num(g.value) ?? 0 }))
        .filter((g) => g.label && g.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, breakdown === 'city' ? 10 : 12)
    }))
    return out
  })
}

/** Test hook: forget cached answers. */
export function clearInsightCache(): void { cache.clear() }
