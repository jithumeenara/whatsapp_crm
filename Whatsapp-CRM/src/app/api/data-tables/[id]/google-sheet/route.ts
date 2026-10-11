import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { GoogleNotConnectedError, googleAccessToken, isGoogleConnected, loadGoogleConnection } from '@/lib/google/oauth'
import { SheetsApiError, createSpreadsheet, getSpreadsheet, spreadsheetUrl } from '@/lib/google/sheets'
import { ensureGoogleTables } from '@/lib/google/store'
import { exportAll, importFromSheet, writeExportHeader } from '@/lib/google/sheet-sync'

/**
 * A Data Store table's Google Sheet links.
 *
 * GET    — both links (export, import) with their status.
 * PUT    — set one up: a picked spreadsheet (and tab), or — for export —
 *          a new spreadsheet the CRM creates.
 * PATCH  — import's "keep in sync every 15 minutes".
 * POST   — run now: { action: 'export_all' | 'import_now' }.
 * DELETE — ?direction=export|import removes that link (the sheet stays).
 */

type Direction = 'export' | 'import'
const isDirection = (v: unknown): v is Direction => v === 'export' || v === 'import'

async function guard(tableId: string) {
  const ctx = await requireRole('admin')
  await ensureGoogleTables()
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: ctx.accountId },
    select: { id: true, name: true },
  })
  return { ctx, table }
}

function present(link: Awaited<ReturnType<typeof prisma.googleSheetLink.findFirst>>) {
  if (!link) return null
  return {
    id: link.id,
    spreadsheet_id: link.spreadsheet_id,
    spreadsheet_name: link.spreadsheet_name,
    sheet_title: link.sheet_title,
    url: spreadsheetUrl(link.spreadsheet_id),
    auto_sync: link.auto_sync,
    imported_rows: link.imported_keys.length,
    last_synced_at: link.last_synced_at,
    last_error: link.last_error,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { ctx, table } = await guard(id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    const [conn, links] = await Promise.all([
      loadGoogleConnection(ctx.accountId),
      prisma.googleSheetLink.findMany({ where: { table_id: id, account_id: ctx.accountId } }),
    ])
    return NextResponse.json({
      connected: conn?.status === 'connected' && Boolean(conn.refresh_token),
      can_pick: Boolean(conn?.api_key),
      google_email: conn?.google_email ?? null,
      export: present(links.find((l) => l.direction === 'export') ?? null),
      import: present(links.find((l) => l.direction === 'import') ?? null),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { ctx, table } = await guard(id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    if (!(await isGoogleConnected(ctx.accountId))) {
      return NextResponse.json({ error: 'Connect Google first, in Settings → Google.' }, { status: 400 })
    }
    const body = (await req.json().catch(() => ({}))) as {
      direction?: unknown
      spreadsheet_id?: unknown
      sheet_title?: unknown
      create_new?: unknown
      auto_sync?: unknown
    }
    if (!isDirection(body.direction)) return NextResponse.json({ error: 'direction must be export or import.' }, { status: 400 })
    const direction = body.direction
    const token = await googleAccessToken(ctx.accountId)

    let spreadsheetId: string
    let spreadsheetName: string
    let sheetTitle: string
    if (body.create_new === true) {
      if (direction !== 'export') {
        return NextResponse.json({ error: 'A new sheet can only be created for sending records out.' }, { status: 400 })
      }
      const created = await createSpreadsheet(token, `${table.name} — CRM`, 'Records')
      spreadsheetId = created.id
      spreadsheetName = created.title
      sheetTitle = created.tabs[0]?.title ?? 'Records'
    } else {
      const sid = typeof body.spreadsheet_id === 'string' ? body.spreadsheet_id.trim() : ''
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(sid)) {
        return NextResponse.json({ error: 'Choose a spreadsheet with "Choose from Google Drive".' }, { status: 400 })
      }
      const info = await getSpreadsheet(token, sid)
      const wanted = typeof body.sheet_title === 'string' ? body.sheet_title.trim() : ''
      const tab = wanted ? info.tabs.find((t) => t.title === wanted) : info.tabs[0]
      if (!tab) return NextResponse.json({ error: `That spreadsheet has no tab named "${wanted}".` }, { status: 400 })
      spreadsheetId = sid
      spreadsheetName = info.title
      sheetTitle = tab.title
    }

    // The same tab in and out would import every exported row back.
    const other = await prisma.googleSheetLink.findUnique({
      where: { table_id_direction: { table_id: id, direction: direction === 'export' ? 'import' : 'export' } },
    })
    if (other && other.spreadsheet_id === spreadsheetId && other.sheet_title === sheetTitle) {
      return NextResponse.json(
        { error: 'That tab is already used the other way for this table. Use a different tab or spreadsheet.' },
        { status: 400 },
      )
    }

    const link = await prisma.googleSheetLink.upsert({
      where: { table_id_direction: { table_id: id, direction } },
      create: {
        account_id: ctx.accountId,
        table_id: id,
        direction,
        spreadsheet_id: spreadsheetId,
        spreadsheet_name: spreadsheetName,
        sheet_title: sheetTitle,
        auto_sync: direction === 'import' && body.auto_sync === true,
      },
      update: {
        spreadsheet_id: spreadsheetId,
        spreadsheet_name: spreadsheetName,
        sheet_title: sheetTitle,
        last_error: null,
        // A different sheet is a fresh start: nothing from it imported yet.
        imported_keys: [],
        ...(direction === 'import' && typeof body.auto_sync === 'boolean' ? { auto_sync: body.auto_sync } : {}),
      },
    })
    if (direction === 'export') await writeExportHeader(link.id, ctx.accountId)
    return NextResponse.json({ link: present(link) })
  } catch (err) {
    // Google's own refusals, said in words the panel can show.
    if (err instanceof SheetsApiError || err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { ctx, table } = await guard(id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    const body = (await req.json().catch(() => ({}))) as { auto_sync?: unknown }
    if (typeof body.auto_sync !== 'boolean') return NextResponse.json({ error: 'auto_sync must be true or false.' }, { status: 400 })
    const updated = await prisma.googleSheetLink.updateMany({
      where: { table_id: id, account_id: ctx.accountId, direction: 'import' },
      data: { auto_sync: body.auto_sync },
    })
    if (updated.count === 0) return NextResponse.json({ error: 'Set up an import sheet first.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { ctx, table } = await guard(id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    const direction: Direction | null = body.action === 'export_all' ? 'export' : body.action === 'import_now' ? 'import' : null
    if (!direction) return NextResponse.json({ error: 'action must be export_all or import_now.' }, { status: 400 })
    const link = await prisma.googleSheetLink.findUnique({ where: { table_id_direction: { table_id: id, direction } } })
    if (!link || link.account_id !== ctx.accountId) {
      return NextResponse.json({ error: `Set up the ${direction} sheet first.` }, { status: 400 })
    }
    try {
      if (direction === 'export') return NextResponse.json(await exportAll(link.id, ctx.accountId))
      return NextResponse.json(await importFromSheet(link.id, ctx.accountId))
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Google Sheets failed.' }, { status: 400 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { ctx, table } = await guard(id)
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    const direction = req.nextUrl.searchParams.get('direction')
    if (!isDirection(direction)) return NextResponse.json({ error: 'direction must be export or import.' }, { status: 400 })
    await prisma.googleSheetLink.deleteMany({ where: { table_id: id, account_id: ctx.accountId, direction } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
