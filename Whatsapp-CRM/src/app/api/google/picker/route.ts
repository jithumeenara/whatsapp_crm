import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { decrypt } from '@/lib/whatsapp/encryption'
import { GoogleNotConnectedError, googleNarrowToken, isGoogleServiceEnabled, loadGoogleConnection, projectNumberOf } from '@/lib/google/oauth'

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'

/**
 * What the browser needs to open the Google Picker: a short-lived access
 * token, the Picker API key and the project number ("app id" — what lets
 * a picked file be opened under drive.file).
 *
 * The token is narrowed to drive.file alone (googleNarrowToken): it can
 * open the files people pick, or the CRM made, and nothing in Gmail or
 * Calendar. That is what lets an agent attach from Drive in the Inbox;
 * choosing sheets for the Data Store stays an admin's.
 */
export async function GET() {
  try {
    const ctx = await requireRole('agent')
    const conn = await loadGoogleConnection(ctx.accountId)
    if (!conn || conn.status !== 'connected') {
      return NextResponse.json({ error: 'Connect Google first, in Settings → Google.' }, { status: 400 })
    }
    const drive = await isGoogleServiceEnabled(ctx.accountId, 'drive')
    const admin = hasMinRole(ctx.role, 'admin')
    const sheets = admin && (await isGoogleServiceEnabled(ctx.accountId, 'sheets'))
    const forms = admin && (await isGoogleServiceEnabled(ctx.accountId, 'forms'))
    if (!drive && !sheets && !forms) {
      return NextResponse.json({ error: 'Connect Google Drive in Settings → Google.' }, { status: 400 })
    }
    if (!conn.api_key) {
      return NextResponse.json({ error: 'Add the Picker API key in Settings → Google.' }, { status: 400 })
    }
    const appId = projectNumberOf(conn.client_id)
    const accessToken = await googleNarrowToken(ctx.accountId, [DRIVE_FILE])
    return NextResponse.json({ accessToken, apiKey: decrypt(conn.api_key), appId, clientId: conn.client_id })
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
