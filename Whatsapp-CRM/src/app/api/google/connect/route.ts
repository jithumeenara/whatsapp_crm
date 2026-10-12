import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_OAUTH_COOKIE,
  googleAuthorizeUrl,
  loadGoogleConnection,
  newPkce,
} from '@/lib/google/oauth'
import { isServiceId, scopesFor, serviceById, type GoogleServiceId } from '@/lib/google/services'

/**
 * "Connect selected": one Google consent screen for the ticked services.
 *
 *   /api/google/connect?services=sheets,calendar
 *   /api/google/connect?services=…&switch=1   (choose a different account)
 *
 * Only the chosen services' scopes are asked for, on top of what the
 * account already granted (include_granted_scopes) — so connecting
 * Calendar later never takes Sheets away.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const conn = await loadGoogleConnection(ctx.accountId)
    const origin = publicOrigin(req)
    if (!conn) return NextResponse.redirect(`${origin}/settings?tab=google&google=setup`)

    const requested = (req.nextUrl.searchParams.get('services') ?? 'sheets')
      .split(',')
      .map((s) => s.trim())
      .filter(isServiceId)
      .filter((id) => serviceById(id)?.availability === 'available') as GoogleServiceId[]
    if (requested.length === 0) {
      return NextResponse.redirect(`${origin}/settings?tab=google&google=error&reason=${encodeURIComponent('Choose at least one service.')}`)
    }
    const switching = req.nextUrl.searchParams.get('switch') === '1'
    // Started from a page (a Data Store table): Google sends them back there.
    const back = req.nextUrl.searchParams.get('return')
    const returnTo = back && /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/.test(back) ? back : null

    const state = crypto.randomBytes(32).toString('base64url')
    const { verifier, challenge } = newPkce()
    const redirectUri = `${origin}${GOOGLE_CALLBACK_PATH}`

    const res = NextResponse.redirect(
      googleAuthorizeUrl({
        clientId: conn.client_id,
        redirectUri,
        state,
        challenge,
        scopes: scopesFor(requested),
        // Adding a service stays on the connected account; switching asks.
        loginHint: !switching && conn.status === 'connected' ? conn.google_email : null,
      }),
    )
    res.cookies.set(
      GOOGLE_OAUTH_COOKIE,
      encrypt(JSON.stringify({ state, verifier, redirectUri, origin, accountId: ctx.accountId, userId: ctx.userId, at: Date.now(), services: requested, switching, returnTo })),
      {
        httpOnly: true,
        secure: origin.startsWith('https://'),
        // Lax, so the cookie comes back on Google's top-level redirect.
        sameSite: 'lax',
        path: '/api/google',
        maxAge: 600,
      },
    )
    return res
  } catch (err) {
    return toErrorResponse(err)
  }
}
