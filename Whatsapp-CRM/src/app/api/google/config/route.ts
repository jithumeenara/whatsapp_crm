import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import {
  GOOGLE_CALLBACK_PATH,
  isGoogleClientId,
  loadGoogleConnection,
  projectNumberOf,
  revokeGoogleToken,
} from '@/lib/google/oauth'

/**
 * The account's Google Cloud OAuth app, and whether it is connected.
 *
 * GET    — status for Settings → Google. Never the secret or a token.
 * PUT    — save client id, client secret and Picker API key. A blank
 *          secret or key keeps the stored one, so editing the client id
 *          does not mean pasting the secret again.
 * DELETE — disconnect: revoke the token at Google, forget everything.
 */

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const conn = await loadGoogleConnection(ctx.accountId)
    const origin = publicOrigin(req)
    const links = conn
      ? await prisma.googleSheetLink.count({ where: { account_id: ctx.accountId } }).catch(() => 0)
      : 0
    return NextResponse.json({
      configured: Boolean(conn),
      connected: conn?.status === 'connected' && Boolean(conn.refresh_token),
      status: conn?.status ?? 'not_configured',
      google_email: conn?.google_email ?? null,
      client_id: conn?.client_id ?? '',
      has_secret: Boolean(conn?.client_secret),
      has_api_key: Boolean(conn?.api_key),
      last_error: conn?.last_error ?? null,
      redirect_uri: `${origin}${GOOGLE_CALLBACK_PATH}`,
      javascript_origin: origin,
      sheet_links: links,
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
      return NextResponse.json(
        { error: 'That is not a Google OAuth client ID. It ends in .apps.googleusercontent.com.' },
        { status: 400 },
      )
    }
    if (secret && !/^[A-Za-z0-9_-]{10,100}$/.test(secret)) {
      return NextResponse.json({ error: 'That client secret does not look right. Copy it again from Google Cloud.' }, { status: 400 })
    }
    if (apiKey && !/^AIza[0-9A-Za-z_-]{20,60}$/.test(apiKey)) {
      return NextResponse.json({ error: 'That API key does not look right. Google API keys start with "AIza".' }, { status: 400 })
    }

    const existing = await loadGoogleConnection(ctx.accountId)
    if (!existing && !secret) {
      return NextResponse.json({ error: 'Paste the client secret too.' }, { status: 400 })
    }

    // A different OAuth app cannot use the old app's tokens.
    const appChanged = Boolean(existing && existing.client_id !== clientId)
    if (existing && appChanged && existing.refresh_token) {
      await revokeGoogleToken(decrypt(existing.refresh_token))
    }

    const data = {
      client_id: clientId,
      ...(secret ? { client_secret: encrypt(secret) } : {}),
      ...(apiKey ? { api_key: encrypt(apiKey) } : {}),
      ...(appChanged
        ? { refresh_token: null, access_token: null, access_expires_at: null, google_email: null, status: 'not_connected', last_error: null }
        : {}),
    }
    if (existing) {
      await prisma.googleConnection.update({ where: { id: existing.id }, data })
    } else {
      await prisma.googleConnection.create({
        data: { account_id: ctx.accountId, user_id: ctx.userId, client_secret: encrypt(secret), ...data },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const existing = await loadGoogleConnection(ctx.accountId)
    if (existing) {
      if (existing.refresh_token) await revokeGoogleToken(decrypt(existing.refresh_token))
      await prisma.googleSheetLink.deleteMany({ where: { account_id: ctx.accountId } })
      await prisma.googleConnection.delete({ where: { id: existing.id } })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
