import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { checkRateLimit } from '@/lib/rate-limit'
import { GRAPH_API_VERSION } from '@/lib/meta/versions'
import { CONNECT_NONCE_COOKIE, CONNECT_STATE_TTL_MS, newNonce, signConnectState } from '@/lib/meta/connect-state'
import { CONNECT_CALLBACK_PATH, connectOrigin, loadSocialApp } from '@/lib/meta/social-connect-server'

/**
 * POST /api/meta/social-connect/start — the workspace owner presses
 * "Connect Facebook & Instagram". Returns Meta's login address (Facebook
 * Login for Business, our config_id) with a signed state, and sets the
 * matching nonce in an httpOnly cookie for this browser only.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const limited = checkRateLimit(`meta-connect:${ctx.userId}`, { limit: 10, windowMs: 10 * 60_000 })
    if (!limited.success) return NextResponse.json({ error: 'Too many attempts. Wait a few minutes and try again.' }, { status: 429 })

    const app = await loadSocialApp()
    if (!app) {
      return NextResponse.json({ error: 'The server owner must first add the Meta App and its Messenger & Instagram configuration ID (Settings → Platform → Meta App).' }, { status: 400 })
    }
    const origin = connectOrigin()
    if (!origin) return NextResponse.json({ error: "This server's public https address is not set (NEXT_PUBLIC_APP_URL)." }, { status: 500 })

    const nonce = newNonce()
    const state = signConnectState({ accountId: ctx.accountId, userId: ctx.userId, nonce })
    const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`)
    url.searchParams.set('client_id', app.appId)
    url.searchParams.set('config_id', app.configId)
    url.searchParams.set('redirect_uri', `${origin}${CONNECT_CALLBACK_PATH}`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('override_default_response_type', 'true')
    url.searchParams.set('state', state)

    await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', { area: 'meta_social_connect', fields: [], meta: { step: 'started' } })

    const res = NextResponse.json({ url: url.toString() })
    res.cookies.set(CONNECT_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: origin.startsWith('https://'),
      sameSite: 'lax',
      path: '/api/meta/social-connect',
      maxAge: Math.floor(CONNECT_STATE_TTL_MS / 1000),
    })
    return res
  } catch (err) {
    return toErrorResponse(err)
  }
}
