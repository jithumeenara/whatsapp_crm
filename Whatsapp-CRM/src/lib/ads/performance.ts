/**
 * Every ad, from click to cash: what Meta charged for it, how many people
 * it brought into a chat or form, how many became leads, how many were won
 * and what they paid. The one chain an ads manager alone cannot see.
 *
 * - Leads belong to their first ad (leads.ad_id, set when the lead is
 *   made or by recordAdTouch). Arrivals count every ad touch in the
 *   period, returning customers too (ad_touches).
 * - Revenue: won Pipeline deals of those leads, per currency.
 * - Spend: Meta's ad-level insights for the same days. Unknown (null),
 *   never zero, when no ad account is connected or Meta cannot be read.
 * - Ads that spent but brought nobody are listed too — the money leaking.
 * - Findings are written by code from these numbers, not by AI.
 *
 * Team-wide money: callers allow owners and admins only.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const GRAPH = 'https://graph.facebook.com/v21.0'
const DAY = /^\d{4}-\d{2}-\d{2}$/

export interface MoneyAmount { currency: string; amount: number }

export interface AdRow {
  adId: string
  adName: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  thumbnailUrl: string | null
  /** From the click itself, when Meta has not shared the ad's name. */
  headline: string | null
  channels: string[]
  arrivals: number
  leads: number
  won: number
  lost: number
  revenue: MoneyAmount[]
  spend: number | null
  clicks: number | null
  costPerLead: number | null
  /** Revenue ÷ spend, only when both are in the ad account's currency. */
  roas: number | null
}

export interface CampaignRow {
  campaignId: string | null
  campaignName: string | null
  ads: number
  arrivals: number
  leads: number
  won: number
  revenue: MoneyAmount[]
  spend: number | null
  costPerLead: number | null
  roas: number | null
}

export interface SpendRow {
  adId: string
  adName: string | null
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  spend: number
  clicks: number
}

export type SpendResult =
  | { status: 'ok'; currency: string | null; rows: SpendRow[] }
  | { status: 'not_connected' | 'no_ad_account' | 'error'; message: string }

export interface AdPerformance {
  ads: AdRow[]
  campaigns: CampaignRow[]
  totals: { arrivals: number; leads: number; won: number; revenue: MoneyAmount[]; spend: number | null; costPerLead: number | null; roas: number | null }
  /** Leads in the period with no ad (other sources), for the share. */
  otherLeads: number
  currency: string | null
  spendStatus: SpendResult['status']
  spendMessage: string | null
  findings: string[]
}

// ── Pure assembly ────────────────────────────────────────────────────────

export interface LeadAgg { ad_id: string; leads: number; won: number; lost: number }
export interface RevenueAgg { ad_id: string; currency: string; amount: number }
export interface TouchAgg { ad_id: string; arrivals: number; channels: string[]; headline: string | null }
export interface CatalogRow { ad_id: string; ad_name: string | null; adset_name: string | null; campaign_id: string | null; campaign_name: string | null; thumbnail_url: string | null }

const round2 = (n: number) => Math.round(n * 100) / 100

function addMoney(list: MoneyAmount[], m: MoneyAmount) {
  const hit = list.find((x) => x.currency === m.currency)
  if (hit) hit.amount = round2(hit.amount + m.amount)
  else list.push({ currency: m.currency, amount: round2(m.amount) })
}

function ratios(spend: number | null, leads: number, revenue: MoneyAmount[], currency: string | null) {
  const costPerLead = spend != null && leads > 0 ? round2(spend / leads) : null
  const same = currency ? revenue.find((r) => r.currency === currency) : undefined
  const roas = spend != null && spend > 0 && same ? round2(same.amount / spend) : null
  return { costPerLead, roas }
}

export function assemble(input: {
  leads: LeadAgg[]
  revenue: RevenueAgg[]
  touches: TouchAgg[]
  catalog: CatalogRow[]
  spend: SpendResult
  otherLeads: number
}): AdPerformance {
  const spendOk = input.spend.status === 'ok' ? input.spend : null
  const currency = spendOk?.currency ?? null
  const ids = new Set<string>([
    ...input.leads.map((r) => r.ad_id),
    ...input.touches.map((r) => r.ad_id),
    ...(spendOk ? spendOk.rows.filter((r) => r.spend > 0).map((r) => r.adId) : []),
  ])
  const cat = new Map(input.catalog.map((c) => [c.ad_id, c]))
  const sp = new Map((spendOk?.rows ?? []).map((r) => [r.adId, r]))
  const ld = new Map(input.leads.map((r) => [r.ad_id, r]))
  const tc = new Map(input.touches.map((r) => [r.ad_id, r]))

  const ads: AdRow[] = [...ids].map((adId) => {
    const c = cat.get(adId)
    const s = sp.get(adId)
    const l = ld.get(adId)
    const t = tc.get(adId)
    const revenue: MoneyAmount[] = []
    for (const r of input.revenue) if (r.ad_id === adId) addMoney(revenue, { currency: r.currency, amount: r.amount })
    const spend = spendOk ? (s ? round2(s.spend) : 0) : null
    const leads = l?.leads ?? 0
    return {
      adId,
      adName: s?.adName ?? c?.ad_name ?? null,
      adsetName: s?.adsetName ?? c?.adset_name ?? null,
      campaignId: s?.campaignId ?? c?.campaign_id ?? null,
      campaignName: s?.campaignName ?? c?.campaign_name ?? null,
      thumbnailUrl: c?.thumbnail_url ?? null,
      headline: t?.headline ?? null,
      channels: t?.channels ?? [],
      arrivals: t?.arrivals ?? 0,
      leads,
      won: l?.won ?? 0,
      lost: l?.lost ?? 0,
      revenue,
      spend,
      clicks: s ? s.clicks : spendOk ? 0 : null,
      ...ratios(spend, leads, revenue, currency),
    }
  })
  ads.sort((a, b) => b.leads - a.leads || (b.spend ?? 0) - (a.spend ?? 0) || b.arrivals - a.arrivals)

  const byCampaign = new Map<string, CampaignRow>()
  for (const a of ads) {
    const key = a.campaignId ?? `name:${a.campaignName ?? ''}`
    const row = byCampaign.get(key) ?? { campaignId: a.campaignId, campaignName: a.campaignName, ads: 0, arrivals: 0, leads: 0, won: 0, revenue: [], spend: spendOk ? 0 : null, costPerLead: null, roas: null }
    row.ads++; row.arrivals += a.arrivals; row.leads += a.leads; row.won += a.won
    for (const r of a.revenue) addMoney(row.revenue, r)
    if (row.spend != null && a.spend != null) row.spend = round2(row.spend + a.spend)
    byCampaign.set(key, row)
  }
  const campaigns = [...byCampaign.values()].map((c) => ({ ...c, ...ratios(c.spend, c.leads, c.revenue, currency) }))
  campaigns.sort((a, b) => b.leads - a.leads || (b.spend ?? 0) - (a.spend ?? 0))

  const totRevenue: MoneyAmount[] = []
  for (const a of ads) for (const r of a.revenue) addMoney(totRevenue, r)
  const totSpend = spendOk ? round2(ads.reduce((s, a) => s + (a.spend ?? 0), 0)) : null
  const totLeads = ads.reduce((s, a) => s + a.leads, 0)
  const totals = {
    arrivals: ads.reduce((s, a) => s + a.arrivals, 0),
    leads: totLeads,
    won: ads.reduce((s, a) => s + a.won, 0),
    revenue: totRevenue,
    spend: totSpend,
    ...ratios(totSpend, totLeads, totRevenue, currency),
  }

  const result: AdPerformance = {
    ads, campaigns, totals, otherLeads: input.otherLeads, currency,
    spendStatus: input.spend.status,
    spendMessage: input.spend.status === 'ok' ? null : input.spend.message,
    findings: [],
  }
  result.findings = findings(result)
  return result
}

const label = (a: { adName: string | null; headline: string | null; adId: string }) => a.adName ?? a.headline ?? `Ad ${a.adId}`
const money = (n: number, currency: string | null) => {
  try {
    return currency ? new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n) : n.toLocaleString('en-IN')
  } catch {
    return `${currency ?? ''} ${Math.round(n).toLocaleString('en-IN')}`.trim()
  }
}

/** Up to three plain sentences, biggest money first. Pure. */
export function findings(p: AdPerformance): string[] {
  const out: string[] = []
  const burning = p.ads.filter((a) => (a.spend ?? 0) > 0 && a.leads === 0).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
  if (burning.length) {
    const total = burning.reduce((s, a) => s + (a.spend ?? 0), 0)
    out.push(burning.length === 1
      ? `"${label(burning[0])}" spent ${money(burning[0].spend ?? 0, p.currency)} and brought no leads.`
      : `${burning.length} ads spent ${money(total, p.currency)} and brought no leads — biggest: "${label(burning[0])}".`)
  }
  const priced = p.ads.filter((a) => a.costPerLead != null && a.leads >= 5).sort((a, b) => (a.costPerLead ?? 0) - (b.costPerLead ?? 0))
  if (priced.length >= 2) {
    const best = priced[0]
    const worst = priced[priced.length - 1]
    if ((worst.costPerLead ?? 0) >= (best.costPerLead ?? 0) * 2) {
      out.push(`"${label(best)}" gets leads at ${money(best.costPerLead ?? 0, p.currency)} each; "${label(worst)}" costs ${money(worst.costPerLead ?? 0, p.currency)}.`)
    }
  }
  const noWins = p.ads.filter((a) => a.leads >= 10 && a.won === 0).sort((a, b) => b.leads - a.leads)
  if (noWins.length) out.push(`"${label(noWins[0])}" brought ${noWins[0].leads} leads and none won yet — check what these customers ask for.`)
  const topWin = p.ads.filter((a) => a.won > 0).sort((a, b) => b.won - a.won)[0]
  if (out.length < 3 && topWin) out.push(`Most wins came from "${label(topWin)}" (${topWin.won}).`)
  return out.slice(0, 3)
}

// ── Meta spend per ad (cached) ──────────────────────────────────────────

const SPEND_CACHE_MS = 5 * 60_000
const spendCache = new Map<string, { at: number; value: SpendResult }>()
export function clearSpendCache() { spendCache.clear() }

export async function spendByAd(accountId: string, since: string, until: string): Promise<SpendResult> {
  if (!DAY.test(since) || !DAY.test(until)) return { status: 'error', message: 'The dates could not be read.' }
  const key = `${accountId}|${since}|${until}`
  const hit = spendCache.get(key)
  if (hit && Date.now() - hit.at < SPEND_CACHE_MS) return hit.value

  const value = await readSpend(accountId, since, until)
  spendCache.set(key, { at: Date.now(), value })
  while (spendCache.size > 200) {
    const oldest = spendCache.keys().next().value
    if (oldest === undefined) break
    spendCache.delete(oldest)
  }
  return value
}

async function readSpend(accountId: string, since: string, until: string): Promise<SpendResult> {
  const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId }, select: { status: true, access_token: true, ad_account_id: true } })
  if (!config || config.status !== 'connected') return { status: 'not_connected', message: 'Connect your ad account in Settings → Ads to see spend next to each ad.' }
  const account = (config.ad_account_id ?? '').trim()
  if (!/^(act_)?\d{5,30}$/.test(account)) return { status: 'no_ad_account', message: 'Add your ad account ID in Settings → Ads to see spend next to each ad.' }
  try {
    const token = decrypt(config.access_token)
    const act = account.startsWith('act_') ? account : `act_${account}`
    const fields = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,clicks,account_currency'
    let next: string | null = `${GRAPH}/${act}/insights?level=ad&limit=500&fields=${fields}&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`
    const rows: SpendRow[] = []
    let currency: string | null = null
    for (let page = 0; next && page < 10; page++) {
      const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        console.error('[ads] Meta refused ad insights:', res.status, (await res.text().catch(() => '')).slice(0, 200))
        return { status: 'error', message: 'Could not read ad spend from Meta. Check the ad account and its access in Settings → Ads.' }
      }
      const body = (await res.json()) as { data?: Array<Record<string, string>>; paging?: { next?: string } }
      for (const r of body.data ?? []) {
        if (!/^\d{5,30}$/.test(r.ad_id ?? '')) continue
        if (!currency && /^[A-Z]{3}$/.test(r.account_currency ?? '')) currency = r.account_currency
        rows.push({
          adId: r.ad_id,
          adName: r.ad_name || null,
          adsetId: r.adset_id || null,
          adsetName: r.adset_name || null,
          campaignId: r.campaign_id || null,
          campaignName: r.campaign_name || null,
          spend: Number(r.spend ?? 0) || 0,
          clicks: Number(r.clicks ?? 0) || 0,
        })
      }
      // Only follow Meta's own paging links.
      next = body.paging?.next && body.paging.next.startsWith(`${GRAPH}/`) ? body.paging.next : null
    }
    // Names come free with spend: keep them for the lead page and Inbox.
    void saveNames(accountId, rows)
    return { status: 'ok', currency, rows }
  } catch (err) {
    console.error('[ads] ad insights failed:', err instanceof Error ? err.message : err)
    return { status: 'error', message: 'Could not read ad spend from Meta. Check the ad account and its access in Settings → Ads.' }
  }
}

async function saveNames(accountId: string, rows: SpendRow[]) {
  try {
    for (const r of rows.slice(0, 200)) {
      if (!r.adName && !r.campaignName) continue
      const data = { ad_name: r.adName, adset_id: r.adsetId, adset_name: r.adsetName, campaign_id: r.campaignId, campaign_name: r.campaignName, error: null, fetched_at: new Date() }
      await prisma.adCatalog.upsert({
        where: { account_id_ad_id: { account_id: accountId, ad_id: r.adId } },
        create: { account_id: accountId, ad_id: r.adId, ...data },
        update: data,
      })
    }
  } catch (err) {
    console.error('[ads] saving ad names failed:', err instanceof Error ? err.message : err)
  }
}

// ── The whole picture for a period ──────────────────────────────────────

type Db = Pick<typeof prisma, '$queryRaw'> & { adCatalog: Pick<typeof prisma.adCatalog, 'findMany'> }

export async function adPerformance(a: { accountId: string; from: Date; to: Date; firstDay: string; lastDay: string; db?: Db; spend?: SpendResult }): Promise<AdPerformance> {
  const acc = a.accountId
  const db: Db = a.db ?? prisma
  const cohort = Prisma.sql`l.account_id = ${acc}::uuid AND l.is_hidden = false AND l.ai_suggested = false AND l.created_at >= ${a.from} AND l.created_at < ${a.to}`
  const [leads, revenue, touches, other, spend] = await Promise.all([
    db.$queryRaw<Array<{ ad_id: string; leads: bigint; won: bigint; lost: bigint }>>`
      SELECT l.ad_id, count(*) AS leads,
        count(*) FILTER (WHERE l.status = 'closed' AND l.converted_at IS NOT NULL) AS won,
        count(*) FILTER (WHERE l.status = 'closed' AND l.converted_at IS NULL AND btrim(coalesce(l.lost_reason, '')) <> '') AS lost
      FROM leads l WHERE ${cohort} AND l.ad_id IS NOT NULL GROUP BY l.ad_id`,
    db.$queryRaw<Array<{ ad_id: string; currency: string | null; amount: Prisma.Decimal | number | null }>>`
      SELECT l.ad_id, d.currency, sum(d.value) AS amount
      FROM deals d JOIN leads l ON l.id = d.lead_id
      WHERE d.account_id = ${acc}::uuid AND d.status = 'won' AND ${cohort} AND l.ad_id IS NOT NULL
      GROUP BY l.ad_id, d.currency`,
    db.$queryRaw<Array<{ ad_id: string; arrivals: bigint; channels: string[]; headline: string | null }>>`
      SELECT t.ad_id, count(*) AS arrivals, array_agg(DISTINCT t.channel) AS channels,
        (array_agg(t.headline ORDER BY t.touched_at DESC) FILTER (WHERE t.headline IS NOT NULL))[1] AS headline
      FROM ad_touches t
      WHERE t.account_id = ${acc}::uuid AND t.ad_id IS NOT NULL AND t.touched_at >= ${a.from} AND t.touched_at < ${a.to}
      GROUP BY t.ad_id`,
    db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM leads l WHERE ${cohort} AND l.ad_id IS NULL`,
    a.spend ?? spendByAd(acc, a.firstDay, a.lastDay),
  ])
  const ids = [...new Set([...leads.map((r) => r.ad_id), ...touches.map((r) => r.ad_id)])]
  const catalog = ids.length
    ? await db.adCatalog.findMany({ where: { account_id: acc, ad_id: { in: ids.slice(0, 1000) } }, select: { ad_id: true, ad_name: true, adset_name: true, campaign_id: true, campaign_name: true, thumbnail_url: true } })
    : []
  // Ads seen without a name yet: look them up for next time.
  const unnamed = ids.filter((id) => !catalog.some((c) => c.ad_id === id))
  if (unnamed.length) void import('./ad-names').then((m) => m.ensureAdNames(acc, unnamed)).catch(() => {})

  return assemble({
    leads: leads.map((r) => ({ ad_id: r.ad_id, leads: Number(r.leads), won: Number(r.won), lost: Number(r.lost) })),
    revenue: revenue.map((r) => ({ ad_id: r.ad_id, currency: r.currency ?? 'INR', amount: Number(r.amount ?? 0) })),
    touches: touches.map((r) => ({ ad_id: r.ad_id, arrivals: Number(r.arrivals), channels: r.channels ?? [], headline: r.headline })),
    catalog,
    spend,
    otherLeads: Number(other[0]?.n ?? 0),
  })
}
