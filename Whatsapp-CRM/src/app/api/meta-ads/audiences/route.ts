import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createCustomAudience, addUsersToCustomAudience } from '@/lib/meta-ads/api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true } })
  return profile?.account_id ?? null
}

// Same filter shape/logic as /api/segments/[id] — duplicated locally
// rather than imported since it's a small, self-contained 15-line helper
// and this route lives in a different domain (ads, not segments).
type FilterRule = { field: string; op: string; value: string }
type FilterConfig = { match?: 'all' | 'any'; rules?: FilterRule[] }

function buildContactWhere(config: FilterConfig, accountId: string): Prisma.ContactWhereInput {
  const { match = 'all', rules = [] } = config
  const clauses: Prisma.ContactWhereInput[] = rules.map((rule) => {
    const { field, op, value } = rule
    switch (op) {
      case 'contains': return { [field]: { contains: value, mode: 'insensitive' } }
      case 'not_contains': return { NOT: { [field]: { contains: value, mode: 'insensitive' } } }
      case 'equals': return { [field]: { equals: value, mode: 'insensitive' } }
      case 'not_equals': return { NOT: { [field]: { equals: value, mode: 'insensitive' } } }
      case 'starts_with': return { [field]: { startsWith: value, mode: 'insensitive' } }
      case 'is_empty': return { OR: [{ [field]: null }, { [field]: '' }] }
      case 'is_not_empty': return { AND: [{ NOT: { [field]: null } }, { NOT: { [field]: '' } }] }
      default: return {}
    }
  })
  return {
    account_id: accountId,
    ...(clauses.length > 0 ? (match === 'all' ? { AND: clauses } : { OR: clauses }) : {}),
  }
}

/** GET /api/meta-ads/audiences — every Segment, with its Meta sync status if any. */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

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
    console.error('Error in Meta Ads audiences GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** POST /api/meta-ads/audiences — { segment_id } — sync (or re-sync) one Segment to Meta. */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = checkRateLimit(`meta-ads-audience-sync:${session.user.id}`, RATE_LIMITS.adminAction)
    if (!rl.success) return NextResponse.json({ error: 'Too many syncs — wait a moment and try again.' }, { status: 429 })

    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

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
    console.error('Error in Meta Ads audiences POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
