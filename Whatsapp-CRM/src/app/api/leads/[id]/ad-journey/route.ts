import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { businessTimezone } from '@/lib/ai/human-date'

const MAX_TOUCHES = 20

/**
 * GET /api/leads/[id]/ad-journey
 *
 * Which ad this lead came from, and every ad its customer arrived through
 * (src/lib/ads/attribution.ts). The lead is loaded with the caller's own
 * account — an id from the URL alone is never enough — and only what the
 * card shows is returned (no click ids).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/leads')
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const lead = await prisma.lead.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { ad_id: true, contact_id: true, source: true },
    })
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const touches = lead.contact_id
      ? await prisma.adTouch.findMany({
          where: { account_id: ctx.accountId, contact_id: lead.contact_id },
          orderBy: { touched_at: 'desc' },
          take: MAX_TOUCHES,
          select: { channel: true, ad_id: true, post_id: true, headline: true, media_url: true, touched_at: true },
        })
      : []
    const adIds = [...new Set([lead.ad_id, ...touches.map((t) => t.ad_id)].filter((x): x is string => Boolean(x)))]
    const catalog = adIds.length
      ? await prisma.adCatalog.findMany({
          where: { account_id: ctx.accountId, ad_id: { in: adIds } },
          select: { ad_id: true, ad_name: true, adset_name: true, campaign_name: true, thumbnail_url: true, effective_status: true, error: true },
        })
      : []
    const names = (adId: string | null) => {
      const c = adId ? catalog.find((x) => x.ad_id === adId) : undefined
      return { adName: c?.ad_name ?? null, adsetName: c?.adset_name ?? null, campaignName: c?.campaign_name ?? null, thumbnailUrl: c?.thumbnail_url ?? null, status: c?.effective_status ?? null }
    }
    const tz = await businessTimezone(ctx.accountId)
    const day = (d: Date) => {
      try {
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: tz })
      } catch {
        return d.toISOString().slice(0, 10)
      }
    }
    const firstTouch = lead.ad_id ? [...touches].reverse().find((t) => t.ad_id === lead.ad_id) : undefined

    return NextResponse.json({
      ad: lead.ad_id
        ? { adId: lead.ad_id, ...names(lead.ad_id), headline: firstTouch?.headline ?? null, channel: firstTouch?.channel ?? null, namesMissing: catalog.find((c) => c.ad_id === lead.ad_id)?.error ?? null }
        : null,
      touches: touches.map((t) => ({
        channel: t.channel,
        adId: t.ad_id,
        postId: t.post_id,
        headline: t.headline,
        mediaUrl: t.media_url,
        at: t.touched_at.toISOString(),
        // The day in the business's time zone, not the viewer's.
        day: day(t.touched_at),
        ...names(t.ad_id),
      })),
    })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not load where this lead came from.' }, { status: 500 })
    return res
  }
}
