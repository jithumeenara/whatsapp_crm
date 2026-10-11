import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import {
  GOOGLE_OAUTH_COOKIE,
  GOOGLE_SCOPES,
  exchangeGoogleCode,
  googleEmail,
  loadGoogleConnection,
  revokeGoogleToken,
} from '@/lib/google/oauth'

/** Where Google sends the person back after the consent screen. */

function back(origin: string, outcome: string, detail?: string) {
  const q = new URLSearchParams({ tab: 'google', google: outcome })
  if (detail) q.set('reason', detail.slice(0, 200))
  const res = NextResponse.redirect(`${origin}/settings?${q}`)
  res.cookies.set(GOOGLE_OAUTH_COOKIE, '', { path: '/api/google', maxAge: 0 })
  return res
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export async function GET(req: NextRequest) {
  const fallbackOrigin = publicOrigin(req)
  let pending: { state: string; verifier: string; redirectUri: string; origin: string; accountId: string; userId: string; at: number }
  try {
    const raw = req.cookies.get(GOOGLE_OAUTH_COOKIE)?.value
    if (!raw) return back(fallbackOrigin, 'error', 'The sign-in took too long or was started elsewhere. Try again.')
    pending = JSON.parse(decrypt(raw))
  } catch {
    return back(fallbackOrigin, 'error', 'The sign-in could not be verified. Try again.')
  }
  const origin = pending.origin || fallbackOrigin

  try {
    const ctx = await requireRole('admin')
    const params = req.nextUrl.searchParams
    if (
      !same(params.get('state') ?? '', pending.state) ||
      pending.accountId !== ctx.accountId ||
      pending.userId !== ctx.userId ||
      Date.now() - pending.at > 10 * 60_000
    ) {
      return back(origin, 'error', 'The sign-in could not be verified. Try again.')
    }

    const googleError = params.get('error')
    if (googleError) {
      return back(origin, 'error', googleError === 'access_denied' ? 'Google access was not allowed.' : googleError)
    }
    const code = params.get('code')
    if (!code) return back(origin, 'error', 'Google did not return a sign-in code.')

    // Without drive.file the CRM can do nothing — Google lets people
    // untick scopes on the consent screen.
    const granted = (params.get('scope') ?? '').split(/\s+/)
    if (!granted.includes('https://www.googleapis.com/auth/drive.file')) {
      return back(origin, 'error', 'Allow "See, edit, create and delete only the specific Google Drive files you use with this app" and try again.')
    }

    const conn = await loadGoogleConnection(ctx.accountId)
    if (!conn) return back(origin, 'error', 'Save the Google app details first.')

    const tokens = await exchangeGoogleCode({
      clientId: conn.client_id,
      clientSecret: decrypt(conn.client_secret),
      code,
      redirectUri: pending.redirectUri,
      verifier: pending.verifier,
    })
    if (!tokens.refresh_token) {
      return back(origin, 'error', 'Google did not allow offline access. Remove the app at myaccount.google.com/permissions and connect again.')
    }

    // A previous connection's grant is retired, not left live at Google.
    if (conn.refresh_token) await revokeGoogleToken(decrypt(conn.refresh_token)).catch(() => {})

    const email = await googleEmail(tokens.access_token)
    await prisma.googleConnection.update({
      where: { id: conn.id },
      data: {
        user_id: ctx.userId,
        google_email: email,
        refresh_token: encrypt(tokens.refresh_token),
        access_token: encrypt(tokens.access_token),
        access_expires_at: new Date(Date.now() + tokens.expires_in * 1000),
        status: 'connected',
        last_error: null,
      },
    })
    console.log('[google] connected', email ?? '(no email)', 'scopes:', tokens.scope ?? GOOGLE_SCOPES)
    return back(origin, 'connected')
  } catch (err) {
    return back(origin, 'error', err instanceof Error ? err.message : 'Could not connect Google.')
  }
}
