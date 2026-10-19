import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { GoogleNotConnectedError, googleAccessToken, logGoogleActivity } from '@/lib/google/oauth'
import { canWriteSheets } from '@/lib/google/sheet-two-way'
import { createSpreadsheet, spreadsheetUrl, SheetsApiError, writeHeaderRow } from '@/lib/google/sheets'
import { safeTabTitle } from '@/lib/google/sheet-rows'

/**
 * POST { title, tab?, headers?: string[] } — a new spreadsheet in the
 * connected Google account, with its header row already written. Used by
 * the chatbot's Google Sheet step and Sheet routing ("Create new sheet").
 *
 * { needs_write: true } when Google is connected without permission to
 * write sheets — the screen then asks for it, in a popup.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`google:createSheet:${ctx.accountId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return NextResponse.json({ error: 'Too many new sheets at once. Wait a minute and try again.' }, { status: 429 })
    const body = (await req.json().catch(() => null)) as { title?: unknown; tab?: unknown; headers?: unknown } | null
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 120) : ''
    if (!title) return NextResponse.json({ error: 'Give the new sheet a name.' }, { status: 400 })
    const tab = safeTabTitle(typeof body?.tab === 'string' && body.tab.trim() ? body.tab : 'Sheet1')
    const headers = Array.isArray(body?.headers)
      ? [...new Set((body.headers as unknown[]).filter((h): h is string => typeof h === 'string').map((h) => h.trim().slice(0, 100)).filter(Boolean))].slice(0, 100)
      : []
    if (!(await canWriteSheets(ctx.accountId))) return NextResponse.json({ needs_write: true })

    const token = await googleAccessToken(ctx.accountId)
    const sheet = await createSpreadsheet(token, title, tab)
    if (headers.length) await writeHeaderRow(token, sheet.id, tab, headers)
    await logGoogleActivity(ctx.accountId, ctx.userId, 'sheet_created', title).catch(() => {})
    return NextResponse.json({ id: sheet.id, name: sheet.title, tab, url: spreadsheetUrl(sheet.id, sheet.tabs[0]?.sheetId), headers })
  } catch (err) {
    if (err instanceof SheetsApiError) return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
