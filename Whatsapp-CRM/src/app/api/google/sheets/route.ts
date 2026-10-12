import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { GoogleNotConnectedError, isGoogleServiceEnabled } from '@/lib/google/oauth'
import { ApiDisabledError, canBrowseSheets, listSpreadsheets } from '@/lib/google/sheet-browse'
import { SheetsApiError } from '@/lib/google/sheets'

/**
 * Every spreadsheet in the connected Google account — the shared sheet
 * chooser (AI Training, Data Store import). Newest first; ?search= by name.
 *
 * Not an error, so the chooser can show the right card instead of text:
 *   { needs_permission: true, can_pick } — "browse all" is not granted
 *   { api_disabled: { api, enable_url } } — switched off in Google Cloud
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    if (!(await canBrowseSheets(ctx.accountId))) {
      return NextResponse.json({ needs_permission: true, can_pick: await isGoogleServiceEnabled(ctx.accountId, 'sheets').catch(() => false) })
    }
    const sp = req.nextUrl.searchParams
    return NextResponse.json(await listSpreadsheets(ctx.accountId, { search: sp.get('search') ?? '', pageToken: sp.get('page') ?? undefined }))
  } catch (err) {
    if (err instanceof ApiDisabledError) {
      return NextResponse.json({ api_disabled: { api: err.disabled.api, enable_url: err.disabled.enableUrl } })
    }
    if (err instanceof SheetsApiError) return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
