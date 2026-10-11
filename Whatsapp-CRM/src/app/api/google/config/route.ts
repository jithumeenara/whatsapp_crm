import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import {
  GOOGLE_CALLBACK_PATH,
  isGoogleClientId,
  loadGoogleConnection,
  logGoogleActivity,
  projectNumberOf,
  revokeGoogleToken,
  verifyGoogleApp,
  type CheckResult,
} from '@/lib/google/oauth'
import { GOOGLE_SERVICES, serviceState, servicesGranted } from '@/lib/google/services'

/**
 * Settings → Google: the app details, the connected account, the services.
 *
 * GET    — everything the hub shows. Never the secret, key or a token.
 * PUT    — save the app details. A blank secret or key keeps the stored
 *          one. Saving runs Verify straight away, so the card says at
 *          once whether the details work.
 * POST   — { action: 'verify' } re-runs the checks.
 * DELETE — ?what=account signs the Google account out (tokens revoked at
 *          Google, app details kept); ?what=all also forgets the app.
 */

async function runVerify(conn: NonNullable<Awaited<ReturnType<typeof loadGoogleConnection>>>, req: NextRequest, userId: string) {
  const origin = publicOrigin(req)
  const checks = await verifyGoogleApp({
    clientId: conn.client_id,
    clientSecret: decrypt(conn.client_secret),
    apiKey: conn.api_key ? decrypt(conn.api_key) : null,
    redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}`,
    origin,
  })
  await prisma.googleConnection.update({
    where: { id: conn.id },
    data: { config_check: checks as unknown as object, config_checked_at: new Date() },
  })
  const failed = checks.filter((c) => c.ok === false).map((c) => c.label)
  await logGoogleActivity(conn.account_id, userId, 'verified', failed.length ? `Problems: ${failed.join(', ')}` : 'All checks passed')
  return checks
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const conn = await loadGoogleConnection(ctx.accountId)
    const origin = publicOrigin(req)
    const [links, activity] = conn
      ? await Promise.all([
          prisma.googleSheetLink.count({ where: { account_id: ctx.accountId } }).catch(() => 0),
          prisma.googleActivity
            .findMany({ where: { account_id: ctx.accountId }, orderBy: { created_at: 'desc' }, take: 20 })
            .catch(() => []),
        ])
      : [0, []]
    const connected = conn?.status === 'connected' && Boolean(conn.refresh_token)
    const stateInput = conn
      ? { connected, granted_scopes: conn.granted_scopes, enabled_services: conn.enabled_services }
      : null
    const checks = (conn?.config_check as CheckResult[] | null) ?? null
    return NextResponse.json({
      configured: Boolean(conn),
      connected,
      status: conn?.status ?? 'not_configured',
      google_email: conn?.google_email ?? null,
      connected_at: conn?.connected_at ?? null,
      last_health_at: conn?.last_health_at ?? null,
      client_id: conn?.client_id ?? '',
      has_secret: Boolean(conn?.client_secret),
      has_api_key: Boolean(conn?.api_key),
      last_error: conn?.last_error ?? null,
      checks,
      checks_at: conn?.config_checked_at ?? null,
      verified: Boolean(checks && checks.length > 0 && checks.every((c) => c.ok !== false)),
      redirect_uri: `${origin}${GOOGLE_CALLBACK_PATH}`,
      javascript_origin: origin,
      sheet_links: links,
      // granted: Google already allowed its scopes, so it can be switched
      // on without another consent screen (Drive shares Sheets' scope).
      services: (() => {
        const granted = new Set(connected && conn ? servicesGranted(conn.granted_scopes) : [])
        return GOOGLE_SERVICES.map((s) => ({ id: s.id, state: serviceState(s, stateInput), granted: granted.has(s.id) }))
      })(),
      activity: activity.map((a) => ({ id: a.id, action: a.action, detail: a.detail, at: a.created_at })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; api_key?: string }
    const clientId = body.client_id?.trim() ?? ''
    const secret = body.client_secret?.trim() ?? ''
    const apiKey = body.api_key?.trim() ?? ''

    if (!isGoogleClientId(clientId) || !projectNumberOf(clientId)) {
      return NextResponse.json({ error: 'That is not a Google OAuth client ID. It ends in .apps.googleusercontent.com.' }, { status: 400 })
    }
    if (secret && !/^[A-Za-z0-9_-]{10,100}$/.test(secret)) {
      return NextResponse.json({ error: 'That client secret does not look right. Copy it again from Google Cloud.' }, { status: 400 })
    }
    if (apiKey && !/^AIza[0-9A-Za-z_-]{20,60}$/.test(apiKey)) {
      return NextResponse.json({ error: 'That API key does not look right. Google API keys start with "AIza".' }, { status: 400 })
    }

    const existing = await loadGoogleConnection(ctx.accountId)
    if (!existing && !secret) return NextResponse.json({ error: 'Paste the client secret too.' }, { status: 400 })

    // A different OAuth app cannot use the old app's tokens.
    const appChanged = Boolean(existing && existing.client_id !== clientId)
    if (existing && appChanged && existing.refresh_token) await revokeGoogleToken(decrypt(existing.refresh_token))

    const data = {
      client_id: clientId,
      ...(secret ? { client_secret: encrypt(secret) } : {}),
      ...(apiKey ? { api_key: encrypt(apiKey) } : {}),
      ...(appChanged
        ? {
            refresh_token: null, access_token: null, access_expires_at: null, google_email: null,
            granted_scopes: [], enabled_services: [], connected_at: null, status: 'not_connected', last_error: null,
          }
        : {}),
    }
    const saved = existing
      ? await prisma.googleConnection.update({ where: { id: existing.id }, data })
      : await prisma.googleConnection.create({ data: { account_id: ctx.accountId, user_id: ctx.userId, client_secret: encrypt(secret), ...data } })
    await logGoogleActivity(ctx.accountId, ctx.userId, 'app_saved', appChanged ? 'New Google app — the account must connect again' : undefined)
    const checks = await runVerify(saved, req, ctx.userId)
    return NextResponse.json({ ok: true, checks })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    if (body.action !== 'verify') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    const conn = await loadGoogleConnection(ctx.accountId)
    if (!conn) return NextResponse.json({ error: 'Save the Google app details first.' }, { status: 400 })
    return NextResponse.json({ checks: await runVerify(conn, req, ctx.userId) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const what = req.nextUrl.searchParams.get('what') === 'all' ? 'all' : 'account'
    const existing = await loadGoogleConnection(ctx.accountId)
    if (!existing) return NextResponse.json({ ok: true })
    if (existing.refresh_token) await revokeGoogleToken(decrypt(existing.refresh_token))
    if (what === 'all') {
      await prisma.googleSheetLink.deleteMany({ where: { account_id: ctx.accountId } })
      await prisma.googleFormLink.deleteMany({ where: { account_id: ctx.accountId } })
      await prisma.googleConnection.delete({ where: { id: existing.id } })
      await logGoogleActivity(ctx.accountId, ctx.userId, 'app_removed')
    } else {
      await prisma.googleConnection.update({
        where: { id: existing.id },
        data: {
          refresh_token: null, access_token: null, access_expires_at: null,
          granted_scopes: [], enabled_services: [], status: 'not_connected', last_error: null,
        },
      })
      await logGoogleActivity(ctx.accountId, ctx.userId, 'disconnected', existing.google_email ?? undefined)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
