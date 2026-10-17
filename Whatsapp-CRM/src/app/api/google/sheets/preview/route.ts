import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { GoogleNotConnectedError } from '@/lib/google/oauth'
import { ApiDisabledError, canBrowseSheets, previewSpreadsheet } from '@/lib/google/sheet-browse'
import { suggestColumns } from '@/lib/google/sheet-sync'
import { SheetsApiError } from '@/lib/google/sheets'
import { ID_HEADER } from '@/lib/google/sheet-two-way-plan'
import { canWriteSheets } from '@/lib/google/sheet-two-way'

/**
 * GET ?spreadsheet=ID[&tab=Name] — a sheet's tabs, first rows and a new
 * field suggested for every column, for importing it as a NEW table (the
 * Data Store page). No table yet, so every column becomes a new field;
 * a "CRM ID" column (left by an earlier sync) is not offered as a field.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const sp = req.nextUrl.searchParams
    // A sheet chosen in Google's own window is readable without "browse all".
    if (sp.get('picked') !== '1' && !(await canBrowseSheets(ctx.accountId))) return NextResponse.json({ needs_permission: true })
    const spreadsheet = sp.get('spreadsheet') ?? ''
    const preview = await previewSpreadsheet(ctx.accountId, spreadsheet, sp.get('tab'))
    const columns = suggestColumns(preview.headers, preview.sample, []).map((c) =>
      c.header.trim().toLowerCase() === ID_HEADER.toLowerCase() ? { ...c, target: 'skip' } : c,
    )
    return NextResponse.json({ ...preview, sample: preview.sample.slice(0, 6), fields: [], columns, can_write: await canWriteSheets(ctx.accountId) })
  } catch (err) {
    if (err instanceof ApiDisabledError) {
      return NextResponse.json({ api_disabled: { api: err.disabled.api, enable_url: err.disabled.enableUrl } })
    }
    if (err instanceof SheetsApiError) return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
