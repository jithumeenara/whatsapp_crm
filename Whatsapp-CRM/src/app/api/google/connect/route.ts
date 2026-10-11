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

/**
 * Starts "Connect Google": a redirect to Google's consent screen, with
 * state and a PKCE verifier kept in a short-lived encrypted cookie that
 * only the callback can read.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const conn = await loadGoogleConnection(ctx.accountId)
    const origin = publicOrigin(req)
    if (!conn) return NextResponse.redirect(`${origin}/settings?tab=google&google=setup`)

    const state = crypto.randomBytes(32).toString('base64url')
    const { verifier, challenge } = newPkce()
    const redirectUri = `${origin}${GOOGLE_CALLBACK_PATH}`

    const res = NextResponse.redirect(googleAuthorizeUrl({ clientId: conn.client_id, redirectUri, state, challenge }))
    res.cookies.set(
      GOOGLE_OAUTH_COOKIE,
      encrypt(JSON.stringify({ state, verifier, redirectUri, origin, accountId: ctx.accountId, userId: ctx.userId, at: Date.now() })),
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
