import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/** GET /api/meta-ads/pixel — the standard Meta Pixel settings for a
 *  client's own website, separate from the WhatsApp Ads connection
 *  above it (a Meta Ads config must already exist — the Pixel reuses
 *  that same access token, it doesn't need its own). */
export async function GET() {
  try {
    // Read-only — any account member can view the pixel_id/tracking
    // snippet token (web_events_secret is explicitly not a login
    // credential, only authorizes "send one web conversion event").
    // Found with no role floor at all in the full-app audit.
    const { accountId } = await requireRole('viewer')

    const config = await prisma.metaAdsConfig.findUnique({
      where: { account_id: accountId },
      select: { pixel_id: true, web_events_secret: true },
    })
    if (!config) return NextResponse.json({ has_ads_config: false })

    return NextResponse.json({
      has_ads_config: true,
      pixel_id: config.pixel_id,
      web_events_secret: config.web_events_secret,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** POST /api/meta-ads/pixel — { pixel_id } — saves it, lazily generating
 *  the web_events_secret (the tracking snippet's URL token) the first
 *  time, same pattern as SmsConfig.webhook_secret. */
export async function POST(req: Request) {
  try {
    // Writes config — 'owner' floor, matching every other credentials-
    // bearing settings route. Found with no role check at all in the
    // full-app audit.
    const { accountId } = await requireRole('owner')

    const { pixel_id } = await req.json().catch(() => ({}))
    if (!pixel_id || typeof pixel_id !== 'string' || !pixel_id.trim()) {
      return NextResponse.json({ error: 'pixel_id is required' }, { status: 400 })
    }

    const existing = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId }, select: { web_events_secret: true } })
    if (!existing) {
      return NextResponse.json({ error: 'Connect Meta Ads (WhatsApp side) first — the Pixel reuses that same access token.' }, { status: 400 })
    }

    const webEventsSecret = existing.web_events_secret ?? crypto.randomBytes(24).toString('hex')
    await prisma.metaAdsConfig.update({
      where: { account_id: accountId },
      data: { pixel_id: pixel_id.trim(), web_events_secret: webEventsSecret },
    })

    return NextResponse.json({ success: true, pixel_id: pixel_id.trim(), web_events_secret: webEventsSecret })
  } catch (error) {
    return toErrorResponse(error)
  }
}
