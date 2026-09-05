import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true } })
  return profile?.account_id ?? null
}

/** GET /api/meta-ads/pixel — the standard Meta Pixel settings for a
 *  client's own website, separate from the WhatsApp Ads connection
 *  above it (a Meta Ads config must already exist — the Pixel reuses
 *  that same access token, it doesn't need its own). */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

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
    console.error('Error in Meta Ads pixel GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** POST /api/meta-ads/pixel — { pixel_id } — saves it, lazily generating
 *  the web_events_secret (the tracking snippet's URL token) the first
 *  time, same pattern as SmsConfig.webhook_secret. */
export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = await resolveAccountId(session.user.id)
    if (!accountId) return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })

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
    console.error('Error in Meta Ads pixel POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
