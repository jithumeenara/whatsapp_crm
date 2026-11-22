import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { CONNECT_NONCE_COOKIE, verifyConnectState } from '@/lib/meta/connect-state'
import { discoverAssets, exchangeCode, saveSocialConnection, tokenInfo } from '@/lib/meta/social-connect'
import { CONNECT_CALLBACK_PATH, assetsForChannel, connectOrigin, createConnectSession, linkedPageId, loadSocialApp, settingsUrl } from '@/lib/meta/social-connect-server'

/**
 * GET /api/meta/social-connect/callback — Meta sends the browser back here
 * with ?code&state after "Connect Instagram" or "Connect Messenger". Only
 * the channel named in the signed state is saved: the Instagram button
 * never connects a Page, the Messenger button never an Instagram account.
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
    return done({ meta_connect: 'error', code: 'not_owner' })
  }

  const q = req.nextUrl.searchParams
  const state = verifyConnectState(q.get('state'), req.cookies.get(CONNECT_NONCE_COOKIE)?.value)
  if (!state || state.accountId !== ctx.accountId || state.userId !== ctx.userId) {
    return done({ meta_connect: 'error', code: 'expired' })
  }
  if (q.get('error')) {
    return done({ meta_connect: 'cancelled' })
  }
  const code = q.get('code')
  if (!code) return done({ meta_connect: 'error', code: 'no_code' })

  const channel = state.channel ?? null
  const app = await loadSocialApp(channel ?? undefined)
  if (!app) return done({ meta_connect: 'error', code: 'no_app' })

  try {
    const token = await exchangeCode(code, `${origin}${CONNECT_CALLBACK_PATH}`, app)
    const info = await tokenInfo(token, app)
    if (!info.valid) return done({ meta_connect: 'error', code: 'bad_token' })
    const found = await discoverAssets(token, app)
    const { pages, instagram } = assetsForChannel(channel, found.pages, found.instagram)
    if (pages.length === 0 && instagram.length === 0) {
      const code = channel === 'instagram' ? 'no_instagram' : channel === 'facebook' ? 'no_page' : 'nothing_shared'
      return done({ meta_connect: 'error', code })
    }

    // One Page and at most one Instagram account (or one Instagram account
    // alone): nothing to choose, save now.
    if (pages.length <= 1 && instagram.length <= 1) {
      const page = pages[0] ?? null
      const ig = instagram[0] ?? null
      const instagramPageId = linkedPageId(found.pages, ig?.id)
      const saved = await saveSocialConnection({ accountId: ctx.accountId, token, app, page, instagram: ig, instagramPageId, scopes: info.scopes, expiresAt: info.expiresAt })
      await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', {
        area: 'meta_social_connect',
        fields: [...(saved.facebook?.connected ? ['facebook'] : []), ...(saved.instagram?.connected ? ['instagram'] : [])],
        meta: { step: 'connected', via: 'login', channel, page_id: page?.id ?? null, instagram_id: ig?.id ?? null },
      })
      // The details stay on the server: the status panel shows each channel's
      // state. The URL carries only a fixed word the screen turns into text.
      const problems = [saved.facebook?.error, saved.instagram?.error, saved.facebook?.webhook && `Messenger webhooks: ${saved.facebook.webhook}`, saved.instagram?.webhook && `Instagram webhooks: ${saved.instagram.webhook}`].filter(Boolean)
      if (problems.length) console.warn('[meta connect] connected with problems:', problems.join(' · ').slice(0, 400))
      return done({ meta_connect: problems.length ? 'partial' : 'connected' })
    }

    // Several: keep the choices (sealed) for 15 minutes and let the owner pick.
    // An Instagram session keeps the Pages only to note the linked one —
    // without their tokens.
    const keptPages = channel === 'instagram' ? found.pages.map((p) => ({ ...p, token: '' })) : pages
    const session = await createConnectSession({ accountId: ctx.accountId, userId: ctx.userId, token, pages: keptPages, instagram, scopes: info.scopes, expiresAt: info.expiresAt, ...(channel ? { channel } : {}) })
    return done({ meta_connect: 'choose', session })
  } catch (err) {
    console.error('[meta connect] callback failed:', err instanceof Error ? err.message : err)
    return done({ meta_connect: 'error', code: 'failed' })
  }
}
