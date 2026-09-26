import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { CALLBACK_PATH, OAUTH_COOKIE, authorizeUrl, loadMailbox, newPkce } from '@/lib/email/microsoft/graph'
import { publicOrigin } from '@/lib/email/microsoft/origin'


/**
 * GET /api/email/microsoft/connect — "Connect with Microsoft".
 *
 * Sends the admin to Microsoft's own sign-in page. What comes back is
 * checked against a short-lived, encrypted, http-only cookie set here:
 * a random `state` (so a sign-in nobody started here is refused) and a
 * PKCE verifier (so an intercepted code is useless without it), plus
 * which account and person started it.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const box = await loadMailbox(ctx.accountId)
    const origin = publicOrigin(req)
    if (!box) {
      return NextResponse.redirect(`${origin}/settings?tab=channels&channel=email&microsoft=setup`)
    }

    const state = crypto.randomBytes(32).toString('base64url')
    const { verifier, challenge } = newPkce()
    const redirectUri = `${origin}${CALLBACK_PATH}`

    const res = NextResponse.redirect(
      authorizeUrl({ tenantId: box.tenant_id, clientId: box.client_id, redirectUri, state, challenge }),
    )
    res.cookies.set(OAUTH_COOKIE, encrypt(JSON.stringify({
      state, verifier, redirectUri, origin,
      accountId: ctx.accountId, userId: ctx.userId,
      at: Date.now(),
    })), {
      httpOnly: true,
      secure: origin.startsWith('https://'),
      // Lax, so the cookie comes back on Microsoft's top-level redirect.
      sameSite: 'lax',
      path: '/api/email/microsoft',
      maxAge: 600,
    })
    return res
  } catch (err) {
    return toErrorResponse(err)
  }
}
