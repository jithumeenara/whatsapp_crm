import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  NOTIFY_PATH, OAUTH_COOKIE, createInboxSubscription, deleteSubscription, exchangeCode, loadMailbox, whoAmI,
} from '@/lib/email/microsoft/graph'
import { publicOrigin } from '@/lib/email/microsoft/origin'

/**
 * GET /api/email/microsoft/callback — where Microsoft sends the admin
 * back after "Allow". Checks everything the connect step wrote down,
 * trades the code for tokens, notes which mailbox signed in, and asks
 * Microsoft Graph to report new Inbox mail to this server.
 *
 * Always ends with a redirect to Settings; the outcome is in the query
 * string, never a token or an error body.
 */

function back(origin: string, outcome: string, detail?: string) {
  const q = new URLSearchParams({ tab: 'channels', channel: 'email', microsoft: outcome })
  if (detail) q.set('reason', detail.slice(0, 160))
  const res = NextResponse.redirect(`${origin}/settings?${q}`)
  res.cookies.set(OAUTH_COOKIE, '', { path: '/api/email/microsoft', maxAge: 0 })
  return res
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export async function GET(req: NextRequest) {
  const fallbackOrigin = publicOrigin(req)
  let pending: {
    state: string; verifier: string; redirectUri: string; origin: string
    accountId: string; userId: string; at: number
  }
  try {
    const raw = req.cookies.get(OAUTH_COOKIE)?.value
    if (!raw) return back(fallbackOrigin, 'error', 'The sign-in took too long or was started elsewhere. Try again.')
    pending = JSON.parse(decrypt(raw))
  } catch {
    return back(fallbackOrigin, 'error', 'The sign-in could not be verified. Try again.')
  }
  const origin = pending.origin || fallbackOrigin

  try {
    const ctx = await requireRole('admin')
    const params = req.nextUrl.searchParams
    const state = params.get('state') ?? ''
    if (
      !same(state, pending.state) ||
      pending.accountId !== ctx.accountId ||
      pending.userId !== ctx.userId ||
      Date.now() - pending.at > 10 * 60_000
    ) {
      return back(origin, 'error', 'The sign-in could not be verified. Try again.')
    }

    const msError = params.get('error')
    if (msError) {
      return back(origin, 'error', params.get('error_description')?.split('\r\n')[0] || msError)
    }
    const code = params.get('code')
    if (!code) return back(origin, 'error', 'Microsoft did not return a sign-in code.')

    const box = await loadMailbox(ctx.accountId)
    if (!box) return back(origin, 'error', 'Save the app details first.')

    const tokens = await exchangeCode({
      tenantId: box.tenant_id,
      clientId: box.client_id,
      clientSecret: decrypt(box.client_secret),
      code,
      redirectUri: pending.redirectUri,
      verifier: pending.verifier,
    })
    if (!tokens.refresh_token) {
      return back(origin, 'error', 'Microsoft did not allow offline access. Check the offline_access permission.')
    }
    const me = await whoAmI(tokens.access_token)

    // A previous mailbox's subscription stops; this one starts.
    if (box.subscription_id && box.access_token) {
      await deleteSubscription(decrypt(box.access_token), box.subscription_id).catch(() => {})
    }

    const notificationUrl = `${origin}${NOTIFY_PATH}`
    let subscription: { id: string; expirationDateTime: string } | null = null
    let subscriptionError: string | null = null
    try {
      subscription = await createInboxSubscription(tokens.access_token, notificationUrl, box.client_state)
    } catch (err) {
      // Connected, but new mail will not arrive until this works; the
      // hourly upkeep keeps trying and the reason is shown in Settings.
      subscriptionError = err instanceof Error ? err.message : String(err)
    }

    await prisma.microsoftMailbox.update({
      where: { id: box.id },
      data: {
        mailbox_email: me.email,
        mailbox_name: me.name,
        refresh_token: encrypt(tokens.refresh_token),
        access_token: encrypt(tokens.access_token),
        access_expires_at: new Date(Date.now() + tokens.expires_in * 1000),
        notification_url: notificationUrl,
        subscription_id: subscription?.id ?? null,
        subscription_expires_at: subscription ? new Date(subscription.expirationDateTime) : null,
        status: subscription ? 'connected' : 'error',
        last_error: subscriptionError ? `Receiving mail is not set up yet: ${subscriptionError}`.slice(0, 500) : null,
      },
    })
    return back(origin, subscription ? 'connected' : 'partial', subscriptionError ?? undefined)
  } catch (err) {
    console.error('[microsoft-mail] connect failed:', err instanceof Error ? err.message : err)
    return back(origin, 'error', err instanceof Error ? err.message : 'Connecting failed.')
  }
}
