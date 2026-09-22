import { NextRequest, NextResponse } from 'next/server'
import { clientIpKey } from '@/lib/net/client-ip'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendWebConversionEvent } from '@/lib/meta-ads/api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

// CORS: this endpoint is called directly from a THIRD-PARTY website's own
// browser JavaScript (the Pixel-pairing snippet Settings > Ads generates),
// not from within this app — so, unlike every other route in this
// codebase, it has to admit cross-origin requests from an origin we don't
// control. Authorization is the web_events_secret in the URL, not same-
// origin — same trust model as the SMS/external webhooks' URL-embedded
// secret, just consumed by a browser instead of another server.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

/**
 * POST /api/meta-ads/track?secret=<web_events_secret>
 *
 * The server-side half of the Pixel-pairing snippet: a client website's
 * own page calls this (fetch, no API key of its own to manage) right
 * alongside its client-side fbq() call, using the SAME event_id in both,
 * so Meta can deduplicate the browser and server copies of one event —
 * the exact mechanism this session's research confirmed Meta requires.
 *
 * Body: { event_name, event_id?, event_source_url?, user_data?: {email?,
 * phone?, fbc?, fbp?}, custom_data?: {currency?, value?, ...} }
 */
export async function POST(req: NextRequest) {
  const ip = clientIpKey(req.headers)
  const rl = checkRateLimit(`meta-ads-track:${ip}`, RATE_LIMITS.inboundWebhookSecret)
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: CORS_HEADERS })
  }

  const secret = req.nextUrl.searchParams.get('secret')?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Missing secret' }, { status: 401, headers: CORS_HEADERS })
  }

  const config = await prisma.metaAdsConfig.findUnique({ where: { web_events_secret: secret } })
  if (!config?.pixel_id) {
    return NextResponse.json({ error: 'Invalid secret, or no Pixel ID configured' }, { status: 401, headers: CORS_HEADERS })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
  }

  const eventName = typeof body.event_name === 'string' ? body.event_name.trim() : ''
  if (!eventName) {
    return NextResponse.json({ error: 'event_name is required' }, { status: 400, headers: CORS_HEADERS })
  }
  const userData = (body.user_data && typeof body.user_data === 'object' ? body.user_data : {}) as Record<string, string>
  const customData = (body.custom_data && typeof body.custom_data === 'object' ? body.custom_data : undefined) as Record<string, unknown> | undefined

  try {
    const accessToken = decrypt(config.access_token)
    await sendWebConversionEvent({
      pixelId: config.pixel_id,
      accessToken,
      eventName,
      eventTime: Math.floor(Date.now() / 1000),
      eventId: typeof body.event_id === 'string' ? body.event_id : undefined,
      eventSourceUrl: typeof body.event_source_url === 'string' ? body.event_source_url : undefined,
      userData: {
        email: userData.email,
        phone: userData.phone,
        fbc: userData.fbc,
        fbp: userData.fbp,
        clientIpAddress: ip !== 'unknown' ? ip : undefined,
        clientUserAgent: req.headers.get('user-agent') ?? undefined,
      },
      customData,
    })
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[meta-ads/track] send failed:', err)
    const message = err instanceof Error ? err.message : 'Failed to send event to Meta'
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS })
  }
}
