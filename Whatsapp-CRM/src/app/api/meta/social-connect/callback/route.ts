import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { CONNECT_NONCE_COOKIE, verifyConnectState } from '@/lib/meta/connect-state'
import { discoverAssets, exchangeCode, saveSocialConnection, tokenInfo } from '@/lib/meta/social-connect'
import { CONNECT_CALLBACK_PATH, connectOrigin, createConnectSession, loadSocialApp, settingsUrl } from '@/lib/meta/social-connect-server'

/**
 * GET /api/meta/social-connect/callback — Meta sends the browser back here
 * with ?code&state after "Connect Facebook & Instagram".
 *
 * Accepted only when: the person is signed in as the workspace owner who
 * started it, the state's signature and 10-minute life are good, and the
 * state's nonce equals the httpOnly cookie set in this browser at the start
 * (blocks login CSRF and replayed redirects). The code is exchanged on the
 * server; the token never reaches the browser.
 */
export async function GET(req: NextRequest) {
  const origin = connectOrigin()
  if (!origin) return NextResponse.json({ error: 'Server address not configured.' }, { status: 500 })
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(settingsUrl(origin, params))
    res.cookies.set(CONNECT_NONCE_COOKIE, '', { path: '/api/meta/social-connect', maxAge: 0 })
    return res
  }

  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('owner')
  } catch {
    return done({ meta_connect: 'error', reason: 'Sign in as the workspace owner, then press Connect again.' })
  }

  const q = req.nextUrl.searchParams
  const state = verifyConnectState(q.get('state'), req.cookies.get(CONNECT_NONCE_COOKIE)?.value)
  if (!state || state.accountId !== ctx.accountId || state.userId !== ctx.userId) {
    return done({ meta_connect: 'error', reason: 'This connection link is not valid or has expired. Press Connect again.' })
  }
  if (q.get('error')) {
    return done({ meta_connect: 'cancelled' })
  }
  const code = q.get('code')
  if (!code) return done({ meta_connect: 'error', reason: 'Meta did not return a code. Press Connect again.' })

  const app = await loadSocialApp()
  if (!app) return done({ meta_connect: 'error', reason: 'The Meta App is not set up on this server.' })

  try {
    const token = await exchangeCode(code, `${origin}${CONNECT_CALLBACK_PATH}`, app)
    const info = await tokenInfo(token, app)
    if (!info.valid) return done({ meta_connect: 'error', reason: 'Meta returned a token that is not valid. Press Connect again.' })
    const { pages, instagram } = await discoverAssets(token, app)
    if (pages.length === 0 && instagram.length === 0) {
      return done({ meta_connect: 'error', reason: 'No Facebook Page or Instagram professional account was shared. Press Connect again and tick your Page and Instagram account.' })
    }

    // One Page and at most one Instagram account (or one Instagram account
    // alone): nothing to choose, save now.
    if (pages.length <= 1 && instagram.length <= 1) {
      const page = pages[0] ?? null
      const ig = instagram[0] ?? null
      const saved = await saveSocialConnection({ accountId: ctx.accountId, token, app, page, instagram: ig, scopes: info.scopes, expiresAt: info.expiresAt })
      await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', {
        area: 'meta_social_connect',
        fields: [...(saved.facebook?.connected ? ['facebook'] : []), ...(saved.instagram?.connected ? ['instagram'] : [])],
        meta: { step: 'connected', via: 'login', page_id: page?.id ?? null, instagram_id: ig?.id ?? null },
      })
      const problems = [saved.facebook?.error, saved.instagram?.error, saved.facebook?.webhook && `Messenger webhooks: ${saved.facebook.webhook}`, saved.instagram?.webhook && `Instagram webhooks: ${saved.instagram.webhook}`].filter(Boolean)
      return done({ meta_connect: problems.length ? 'partial' : 'connected', ...(problems.length ? { reason: problems.join(' · ').slice(0, 400) } : {}) })
    }

    // Several: keep the choices (sealed) for 15 minutes and let the owner pick.
    const session = await createConnectSession({ accountId: ctx.accountId, userId: ctx.userId, token, pages, instagram, scopes: info.scopes, expiresAt: info.expiresAt })
    return done({ meta_connect: 'choose', session })
  } catch (err) {
    console.error('[meta connect] callback failed:', err instanceof Error ? err.message : err)
    return done({ meta_connect: 'error', reason: err instanceof Error ? err.message.slice(0, 300) : 'The connection did not finish. Press Connect again.' })
  }
}
