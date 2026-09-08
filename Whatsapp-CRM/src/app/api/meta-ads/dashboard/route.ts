import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchAdAccountInsights } from '@/lib/meta-ads/api'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/meta-ads/dashboard
 *
 * Feeds the /ads page's stat cards with real numbers only — spend/clicks
 * come from Meta's own Ads Insights API (only fetched if an ad account ID
 * is on file); attribution counts come straight from this CRM's own
 * database (conversations with a stored ctwa_clid, real Lead Ads
 * submissions). Never a placeholder value dressed up as real data —
 * fields the account hasn't connected come back null, not zero.
 */
export async function GET() {
  try {
    // Read-only — found with no role floor at all in the full-app audit.
    const { accountId } = await requireRole('viewer')

    const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId } })
    if (!config || config.status !== 'connected') {
      return NextResponse.json({ connected: false })
    }

    const [attributedConversations, leadAdsCaptured, qualifiedFromAds, recentSubmissions] = await Promise.all([
      prisma.conversation.count({
        where: { account_id: accountId, channel: 'whatsapp', ctwa_clid: { not: null } },
      }),
      prisma.leadAdSubmission.count({ where: { account_id: accountId } }),
      prisma.lead.count({
        where: {
          account_id: accountId,
          lead_quality: 'qualified',
          contact: { conversations: { some: { channel: 'whatsapp', ctwa_clid: { not: null } } } },
        },
      }),
      prisma.leadAdSubmission.findMany({
        where: { account_id: accountId },
        orderBy: { created_at: 'desc' },
        take: 10,
        include: {
          form: { select: { name: true } },
          lead: { select: { id: true, status: true, lead_quality: true, contact: { select: { name: true, phone: true } } } },
        },
      }),
    ])

    const recentLeads = recentSubmissions.map((s) => ({
      id: s.id,
      created_at: s.created_at,
      // form is nullable — a submission whose webhook never carried a
      // resolvable form_id (see LeadAdSubmission.form_id's own comment).
      form_name: s.form?.name ?? null,
      lead_id: s.lead?.id ?? null,
      contact_name: s.lead?.contact?.name ?? null,
      contact_phone: s.lead?.contact?.phone ?? null,
      status: s.lead?.status ?? null,
      lead_quality: s.lead?.lead_quality ?? null,
    }))

    let insights = null
    let insightsError: string | null = null
    if (config.ad_account_id) {
      try {
        const accessToken = decrypt(config.access_token)
        insights = await fetchAdAccountInsights({ adAccountId: config.ad_account_id, accessToken })
      } catch (err) {
        insightsError = err instanceof Error ? err.message : 'Failed to fetch ad spend from Meta'
      }
    }

    const costPerLead = insights && leadAdsCaptured > 0 ? insights.spend / leadAdsCaptured : null

    return NextResponse.json({
      connected: true,
      dataset_ready: !!config.dataset_id,
      insights,
      insights_error: insightsError,
      attributed_conversations: attributedConversations,
      lead_ads_captured: leadAdsCaptured,
      qualified_from_ads: qualifiedFromAds,
      cost_per_lead: costPerLead,
      recent_leads: recentLeads,
    })
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status === 401 || status === 403) return toErrorResponse(error)
    console.error('Error in Meta Ads dashboard GET:', error)
    return NextResponse.json({ connected: false, error: 'Internal server error' }, { status: 500 })
  }
}
