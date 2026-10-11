import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { GoogleNotConnectedError, googleAccessToken, loadGoogleConnection, projectNumberOf } from '@/lib/google/oauth'

/**
 * What the browser needs to open the Google Picker: a short-lived access
 * token, the Picker API key and the project number ("app id" — what lets
 * a picked file be opened under drive.file).
 *
 * The token is the one thing about the connection that reaches a browser,
 * and only an admin's. Under drive.file it can open nothing beyond the
 * files the person picks or the CRM made, and it expires within the hour.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const conn = await loadGoogleConnection(ctx.accountId)
    if (!conn || conn.status !== 'connected') {
      return NextResponse.json({ error: 'Connect Google first, in Settings → Google.' }, { status: 400 })
    }
    if (!conn.api_key) {
      return NextResponse.json({ error: 'Add the Picker API key in Settings → Google.' }, { status: 400 })
    }
    const appId = projectNumberOf(conn.client_id)
    const accessToken = await googleAccessToken(ctx.accountId)
    return NextResponse.json({ accessToken, apiKey: decrypt(conn.api_key), appId, clientId: conn.client_id })
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
