/**
 * Leads that came from Meta ads, and what Meta says they cost: one
 * definition for the /ads page and the owner dashboard.
 *
 * A lead from an ad is either a Lead Ads form submission, or a lead whose
 * contact first wrote through a click-to-WhatsApp ad (a stored ctwa_clid)
 * and that has no form submission (so nobody is counted twice).
 */
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchAdAccountInsights } from '@/lib/meta-ads/api'

export interface AdLeadCount {
  form: number
  clickToWhatsApp: number
  total: number
}

export type MetaAdsPeriod =
  | { connected: false }
  | {
      connected: true
      /** Null when no ad account is on file or Meta could not be read: unknown, not zero. */
      spend: number | null
      currency: string | null
      clicks: number | null
      impressions: number | null
      leads: AdLeadCount
      costPerLead: number | null
      /** A plain sentence for the screen; Meta's own text stays in the server log. */
      error: string | null
      needsAdAccount: boolean
    }

export async function countAdLeads(accountId: string, start: Date, end: Date): Promise<AdLeadCount> {
  const inWindow = { gte: start, lt: end }
  const [form, clickToWhatsApp] = await Promise.all([
    prisma.leadAdSubmission.count({ where: { account_id: accountId, created_at: inWindow } }),
    prisma.lead.count({
      where: {
        account_id: accountId,
        ai_suggested: false,
        created_at: inWindow,
        lead_ad_submissions: { none: {} },
        contact: { conversations: { some: { channel: 'whatsapp', ctwa_clid: { not: null } } } },
      },
    }),
  ])
  return { form, clickToWhatsApp, total: form + clickToWhatsApp }
}

/**
 * Spend from Meta for the days `since`..`until` (inclusive, "YYYY-MM-DD"),
 * beside the ad leads that arrived in [start, end). Not connected comes
 * back as `{ connected: false }`, never as zeros.
 */
export async function loadMetaAdsPeriod(a: { accountId: string; since: string; until: string; start: Date; end: Date }): Promise<MetaAdsPeriod> {
  const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: a.accountId } })
  if (!config || config.status !== 'connected') return { connected: false }

  const leadsP = countAdLeads(a.accountId, a.start, a.end)
  let insights: Awaited<ReturnType<typeof fetchAdAccountInsights>> = null
  let error: string | null = null
  if (config.ad_account_id) {
    try {
      insights = await fetchAdAccountInsights({ adAccountId: config.ad_account_id, accessToken: decrypt(config.access_token), timeRange: { since: a.since, until: a.until } })
    } catch (err) {
      console.error('[meta-ads/ad-leads] insights failed:', err instanceof Error ? err.message : err)
      error = 'Could not read ad spend from Meta. Check the ad account and its access in Ads settings.'
    }
  }
  const leads = await leadsP
  // Meta returns no row for days with no delivery: that is zero spend, known.
  const spend = !config.ad_account_id || error ? null : insights ? insights.spend : 0
  return {
    connected: true,
    spend,
    currency: insights?.currency ?? null,
    clicks: insights ? insights.clicks : null,
    impressions: insights ? insights.impressions : null,
    leads,
    costPerLead: spend !== null && leads.total > 0 ? Math.round((spend / leads.total) * 100) / 100 : null,
    error,
    needsAdAccount: !config.ad_account_id,
  }
}
