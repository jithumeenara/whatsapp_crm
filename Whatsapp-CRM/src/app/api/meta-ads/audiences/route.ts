import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createCustomAudience, addUsersToCustomAudience } from '@/lib/meta-ads/api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildContactWhere, type FilterConfig } from '@/lib/segments/filter'

/** GET /api/meta-ads/audiences — every Segment, with its Meta sync status if any. */
export async function GET() {
  try {
    // Read-only — found with no role floor at all in the full-app audit.
    const { accountId } = await requireRole('viewer')

    const [segments, adsConfig] = await Promise.all([
      prisma.segment.findMany({
        where: { account_id: accountId },
        include: { meta_custom_audience: true },
        orderBy: { created_at: 'desc' },
      }),
      prisma.metaAdsConfig.findUnique({ where: { account_id: accountId } }),
    ])

    return NextResponse.json({
      ready: !!adsConfig?.ad_account_id && adsConfig.status === 'connected',
      segments: segments.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        sync: s.meta_custom_audience
          ? {
              meta_audience_id: s.meta_custom_audience.meta_audience_id,
              synced_count: s.meta_custom_audience.synced_count,
              last_synced_at: s.meta_custom_audience.last_synced_at,
              last_error: s.meta_custom_audience.last_error,
            }
          : null,
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** POST /api/meta-ads/audiences — { segment_id } — sync (or re-sync) one Segment to Meta. */
export async function POST(req: NextRequest) {
  try {
    // Pushes contact PII (hashed) to Meta and writes DB state — 'agent'
    // floor, same as this app's other real operational actions. Found
    // with no role check at all in the full-app audit.
    const { accountId, userId } = await requireRole('agent')

    const rl = checkRateLimit(`meta-ads-audience-sync:${userId}`, RATE_LIMITS.adminAction)
    if (!rl.success) return NextResponse.json({ error: 'Too many syncs — wait a moment and try again.' }, { status: 429 })

    const { segment_id } = await req.json().catch(() => ({}))
    if (!segment_id) return NextResponse.json({ error: 'segment_id is required' }, { status: 400 })

    const [segment, adsConfig] = await Promise.all([
      prisma.segment.findFirst({ where: { id: segment_id, account_id: accountId }, include: { meta_custom_audience: true } }),
      prisma.metaAdsConfig.findUnique({ where: { account_id: accountId } }),
    ])
    if (!segment) return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
    if (!adsConfig || adsConfig.status !== 'connected' || !adsConfig.ad_account_id) {
      return NextResponse.json({ error: 'Connect Meta Ads with an Ad Account ID first (see Ads settings).' }, { status: 400 })
    }

    const accessToken = decrypt(adsConfig.access_token)
    const where = buildContactWhere(segment.filter_config as FilterConfig, accountId)
    const contacts = await prisma.contact.findMany({ where, select: { email: true, phone: true }, take: 5000 })

    try {
      let audienceId = segment.meta_custom_audience?.meta_audience_id ?? null
      if (!audienceId) {
        const created = await createCustomAudience({
          adAccountId: adsConfig.ad_account_id,
          accessToken,
          name: `${segment.name} (WhatsApp CRM)`,
          description: segment.description ?? undefined,
        })
        audienceId = created.audienceId
      }

      const { uploaded } = await addUsersToCustomAudience({
        audienceId,
        accessToken,
        emails: contacts.map((c) => c.email ?? '').filter(Boolean),
        // The "email:..." placeholder (contacts with no real number) would
        // hash into meaningless noise — excluded the same way Broadcasts
        // excludes it from real send targeting.
        phones: contacts.map((c) => c.phone).filter((p) => p && !p.startsWith('email:')),
      })

      await prisma.metaCustomAudience.upsert({
        where: { segment_id: segment.id },
        create: { account_id: accountId, segment_id: segment.id, meta_audience_id: audienceId, synced_count: uploaded, last_synced_at: new Date(), last_error: null },
        update: { meta_audience_id: audienceId, synced_count: uploaded, last_synced_at: new Date(), last_error: null },
      })

      return NextResponse.json({ success: true, audience_id: audienceId, synced_count: uploaded, contact_count: contacts.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error syncing to Meta'
      await prisma.metaCustomAudience.upsert({
        where: { segment_id: segment.id },
        create: { account_id: accountId, segment_id: segment.id, meta_audience_id: segment.meta_custom_audience?.meta_audience_id ?? '', last_error: message },
        update: { last_error: message },
      })
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (error) {
    return toErrorResponse(error)
  }
}
