import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import {
  GOOGLE_OAUTH_COOKIE,
  exchangeGoogleCode,
  googleEmail,
  loadGoogleConnection,
  logGoogleActivity,
  normaliseScopes,
  revokeGoogleToken,
} from '@/lib/google/oauth'
import { isServiceId, serviceById, servicesGranted, type GoogleServiceId } from '@/lib/google/services'

/**
 * Where Google sends the person back after the consent screen.
 *
 * Google shows each permission as its own checkbox, so what comes back may
 * be less than was asked for. The granted scopes are read from Google's
 * answer; each requested service is switched on only if all its scopes
 * are there, and the ones that are not are named on the way back.
 */

function back(origin: string, outcome: string, detail?: string) {
  const q = new URLSearchParams({ tab: 'google', google: outcome })
  if (detail) q.set('reason', detail.slice(0, 300))
  const res = NextResponse.redirect(`${origin}/settings?${q}`)
  res.cookies.set(GOOGLE_OAUTH_COOKIE, '', { path: '/api/google', maxAge: 0 })
  return res
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

interface Pending {
  state: string
  verifier: string
  redirectUri: string
  origin: string
  accountId: string
  userId: string
  at: number
  services?: string[]
  switching?: boolean
}

export async function GET(req: NextRequest) {
  const fallbackOrigin = publicOrigin(req)
  let pending: Pending
  try {
    const raw = req.cookies.get(GOOGLE_OAUTH_COOKIE)?.value
    if (!raw) return back(fallbackOrigin, 'error', 'The sign-in took too long or was started elsewhere. Try again.')
    pending = JSON.parse(decrypt(raw)) as Pending
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
    if (googleError) return back(origin, 'error', googleError === 'access_denied' ? 'Google access was not allowed.' : googleError)
    const code = params.get('code')
    if (!code) return back(origin, 'error', 'Google did not return a sign-in code.')

    const conn = await loadGoogleConnection(ctx.accountId)
    if (!conn) return back(origin, 'error', 'Save the Google app details first.')

    const tokens = await exchangeGoogleCode({
      clientId: conn.client_id,
      clientSecret: decrypt(conn.client_secret),
      code,
      redirectUri: pending.redirectUri,
      verifier: pending.verifier,
    })
    if (!tokens.refresh_token && !conn.refresh_token) {
      return back(origin, 'error', 'Google did not allow offline access. Remove the app at myaccount.google.com/permissions and connect again.')
    }

    const email = await googleEmail(tokens.access_token)
    // Same account as before → add to what it had. A different account
    // (switch) starts from nothing: the old account's grant is revoked.
    const sameAccount = Boolean(conn.google_email && email && conn.google_email === email && conn.status === 'connected')
    if (!sameAccount && conn.refresh_token) await revokeGoogleToken(decrypt(conn.refresh_token)).catch(() => {})

    const granted = normaliseScopes(tokens.scope ?? params.get('scope') ?? '')
    const requested = (pending.services ?? ['sheets']).filter(isServiceId) as GoogleServiceId[]
    const grantedServices = new Set(servicesGranted(granted))
    const nowOn = requested.filter((id) => grantedServices.has(id))
    const missing = requested.filter((id) => !grantedServices.has(id))
    const keep = sameAccount ? conn.enabled_services.filter((id) => isServiceId(id) && grantedServices.has(id as GoogleServiceId)) : []
    const enabled = [...new Set([...keep, ...nowOn])]

    await prisma.googleConnection.update({
      where: { id: conn.id },
      data: {
        user_id: ctx.userId,
        google_email: email,
        // A refresh token only comes with fresh consent; an incremental
        // grant may not send a new one, and the old one then covers all.
        ...(tokens.refresh_token ? { refresh_token: encrypt(tokens.refresh_token) } : {}),
        access_token: encrypt(tokens.access_token),
        access_expires_at: new Date(Date.now() + tokens.expires_in * 1000),
        granted_scopes: granted,
        enabled_services: enabled,
        status: 'connected',
        last_error: null,
        ...(sameAccount ? {} : { connected_at: new Date() }),
      },
    })
    const names = (ids: readonly string[]) => ids.map((id) => serviceById(id)?.name ?? id).join(', ')
    await logGoogleActivity(
      ctx.accountId,
      ctx.userId,
      sameAccount ? 'services_added' : 'connected',
      `${email ?? 'Google account'} — on: ${names(enabled) || 'none'}${missing.length ? `; not allowed: ${names(missing)}` : ''}`,
    )

    if (missing.length > 0) {
      return back(
        origin,
        nowOn.length > 0 ? 'partial' : 'error',
        `Google did not allow everything for: ${names(missing)}. Connect again and keep every checkbox ticked on Google's screen.`,
      )
    }
    return back(origin, 'connected', names(nowOn))
  } catch (err) {
    return back(origin, 'error', err instanceof Error ? err.message : 'Could not connect Google.')
  }
}
