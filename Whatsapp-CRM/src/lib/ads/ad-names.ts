/**
 * An ad's name, its ad set and campaign, read once from Meta and kept in
 * ad_catalog (migration 162), so screens show "Diwali offer · November
 * leads" instead of "120213456789".
 *
 * Token: the account's Meta Ads connection (Settings → Ads), the same one
 * the Ads dashboard reads spend with; reading an ad needs ads_read on its
 * ad account. Without a connection, or when Meta refuses, the row records
 * why and the screens fall back to the ad's headline from the click.
 *
 * Kept fresh enough: a found ad is read again after 7 days (names and
 * status change), a failed one after 1 day. At most 25 ads per call.
 * Never throws.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const GRAPH = 'https://graph.facebook.com/v21.0'
const META_ID = /^\d{5,30}$/
const FRESH_MS = 7 * 24 * 60 * 60_000
const RETRY_MS = 24 * 60 * 60_000
const MAX_PER_CALL = 25

export const NO_CONNECTION = 'Connect your ad account in Settings → Ads to see ad and campaign names.'
export const NO_ACCESS = 'Meta did not share this ad. Check that the connected ad account owns it and has ads_read.'

export interface AdNames {
  adName: string | null
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  thumbnailUrl: string | null
  effectiveStatus: string | null
}

const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Meta's ad object → names. Pure. */
export function namesFromGraph(body: unknown): AdNames | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const adset = (b.adset && typeof b.adset === 'object' ? b.adset : {}) as Record<string, unknown>
  const campaign = (b.campaign && typeof b.campaign === 'object' ? b.campaign : {}) as Record<string, unknown>
  const creative = (b.creative && typeof b.creative === 'object' ? b.creative : {}) as Record<string, unknown>
  const thumb = str(creative.thumbnail_url, 2000)
  const names: AdNames = {
    adName: str(b.name),
    adsetId: str(adset.id, 40),
    adsetName: str(adset.name),
    campaignId: str(campaign.id, 40),
    campaignName: str(campaign.name),
    thumbnailUrl: thumb && /^https:\/\//i.test(thumb) ? thumb : null,
    effectiveStatus: str(b.effective_status, 40),
  }
  return names.adName || names.campaignName ? names : null
}

async function fetchAd(adId: string, token: string): Promise<AdNames | null> {
  const fields = 'name,effective_status,adset{id,name},campaign{id,name},creative{thumbnail_url}'
  const res = await fetch(`${GRAPH}/${adId}?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    // Meta's own words stay in the log; the screen gets NO_ACCESS.
    const detail = await res.text().catch(() => '')
    console.error('[ads] Meta refused ad lookup:', res.status, detail.slice(0, 200))
    return null
  }
  return namesFromGraph(await res.json())
}

/** Looks up any of these ads not known (or stale) for this account. */
export async function ensureAdNames(accountId: string, adIds: string[], now = new Date()): Promise<number> {
  try {
    const wanted = [...new Set(adIds.filter((a) => META_ID.test(a)))].slice(0, MAX_PER_CALL)
    if (!accountId || wanted.length === 0) return 0
    const known = await prisma.adCatalog.findMany({
      where: { account_id: accountId, ad_id: { in: wanted } },
      select: { ad_id: true, fetched_at: true, error: true },
    })
    const fresh = new Set(
      known
        .filter((k) => now.getTime() - k.fetched_at.getTime() < (k.error ? RETRY_MS : FRESH_MS))
        .map((k) => k.ad_id),
    )
    const todo = wanted.filter((a) => !fresh.has(a))
    if (todo.length === 0) return 0

    const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId }, select: { status: true, access_token: true } })
    let token: string | null = null
    try {
      token = config?.status === 'connected' && config.access_token ? decrypt(config.access_token) : null
    } catch {
      token = null
    }

    let found = 0
    for (const adId of todo) {
      let names: AdNames | null = null
      let error: string | null = null
      if (!token) error = NO_CONNECTION
      else {
        try {
          names = await fetchAd(adId, token)
          if (!names) error = NO_ACCESS
        } catch (err) {
          console.error('[ads] ad lookup failed:', err instanceof Error ? err.message : err)
          error = NO_ACCESS
        }
      }
      const data = {
        ad_name: names?.adName ?? null,
        adset_id: names?.adsetId ?? null,
        adset_name: names?.adsetName ?? null,
        campaign_id: names?.campaignId ?? null,
        campaign_name: names?.campaignName ?? null,
        thumbnail_url: names?.thumbnailUrl ?? null,
        effective_status: names?.effectiveStatus ?? null,
        error,
        fetched_at: now,
      }
      // A failed retry never wipes names found earlier.
      const keepOld = !names && known.some((k) => k.ad_id === adId && !k.error)
      await prisma.adCatalog.upsert({
        where: { account_id_ad_id: { account_id: accountId, ad_id: adId } },
        create: { account_id: accountId, ad_id: adId, ...data },
        update: keepOld ? { fetched_at: now } : data,
      })
      if (names) found++
    }
    return found
  } catch (err) {
    console.error('[ads] ensureAdNames failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
