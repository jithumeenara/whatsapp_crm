import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { CONNECT_NONCE_COOKIE, isAssetKind, verifyConnectState } from '@/lib/meta/connect-state'
import { createAssetSession, discoverAdAccounts, discoverCatalogs, hasAssetScope, saveAssets, tokenGrants } from '@/lib/meta/asset-connect'
import { isAppDenied } from '@/lib/meta/graph-errors'
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
  // Ads / Catalog return to their own Settings tab (read before the state is
  // checked; a forged value only changes which tab shows the error).
  let tab: 'channels' | 'ads' | 'catalog' = 'channels'
  const done = (params: Record<string, string>) => {
    const res = NextResponse.redirect(settingsUrl(origin, params, tab))
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
  if (isAssetKind(channel)) tab = channel === 'ads' ? 'ads' : 'catalog'
  const app = await loadSocialApp(channel ?? undefined)
  if (!app) return done({ meta_connect: 'error', code: 'no_app' })

  if (isAssetKind(channel)) {
    try {
      const token = await exchangeCode(code, `${origin}${CONNECT_CALLBACK_PATH}`, app)
      const grants = await tokenGrants(token, app)
      if (!grants.valid) return done({ meta_connect: 'error', code: 'bad_token', kind: channel })
      // Permission names and counts only — never a token or an id.
      const granted = Object.entries(grants.targets).map(([k, v]) => `${k}:${v.length}`).join(',')
      if (!hasAssetScope(channel, grants.scopes)) {
        console.warn(`[meta connect] ${channel} login without the needed permission; scopes: ${grants.scopes.join(',').slice(0, 300)}`)
        return done({ meta_connect: 'error', code: channel === 'ads' ? 'no_ads_permission' : 'no_catalog_permission', kind: channel })
      }
      const graphErrors: Array<{ code?: number; message?: string }> = []
      const assets = channel === 'ads' ? await discoverAdAccounts(token, app, grants, graphErrors) : await discoverCatalogs(token, app, grants, graphErrors)
      if (assets.length === 0) {
        // Codes only in the log — Meta's message can name the business.
        const codes = [...new Set(graphErrors.map((e) => e.code).filter((c) => typeof c === 'number'))].join(',')
        console.warn(`[meta connect] ${channel} login shared nothing we could read; scopes: ${grants.scopes.join(',').slice(0, 300)}; targets: ${granted || 'none'}; graph error codes: ${codes || 'none'}`)
        // Meta refused the app (permission / access level): ticking more
        // boxes will not help — the app needs that access in Meta.
        if (isAppDenied(graphErrors)) return done({ meta_connect: 'error', code: channel === 'ads' ? 'ads_app_denied' : 'catalog_app_denied', kind: channel })
        return done({ meta_connect: 'error', code: channel === 'ads' ? 'no_ad_account' : 'no_catalog', kind: channel })
      }
      if (assets.length === 1) {
        await saveAssets({ accountId: ctx.accountId, userId: ctx.userId, kind: channel, token, scopes: grants.scopes, assets })
        await auditConfigChange(auditCtx(req, ctx), 'config.channel_changed', {
          area: 'meta_asset_connect', fields: [channel], meta: { step: 'connected', kind: channel, ids: assets.map((a) => a.id) },
        })
        return done({ meta_connect: 'connected', kind: channel })
      }
      const session = await createAssetSession({ accountId: ctx.accountId, userId: ctx.userId, kind: channel, token, assets, scopes: grants.scopes })
      return done({ meta_connect: 'choose_asset', kind: channel, session })
    } catch (err) {
      console.error('[meta connect] asset callback failed:', err instanceof Error ? err.message : err)
      return done({ meta_connect: 'error', code: 'failed', kind: channel })
    }
  }

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
