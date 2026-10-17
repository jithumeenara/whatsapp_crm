import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { GoogleNotConnectedError, googleAccessToken, isGoogleServiceEnabled, loadGoogleConnection } from '@/lib/google/oauth'
import { SheetsApiError, createSpreadsheet, getSpreadsheet, spreadsheetUrl, writeTab } from '@/lib/google/sheets'
import { ensureGoogleTables } from '@/lib/google/store'
import { applyColumnChoices, exportAll, importFromSheet, suggestColumns, writeExportHeader, type ColumnChoice } from '@/lib/google/sheet-sync'
import { canBrowseSheets, previewSpreadsheet } from '@/lib/google/sheet-browse'
import { canWriteSheets, runSheetSync } from '@/lib/google/sheet-two-way'
import { ID_HEADER, NOT_SYNCED } from '@/lib/google/sheet-two-way-plan'

/** Sheets switched on in either form: picked files, or browse all. */
async function sheetsUsable(accountId: string): Promise<boolean> {
  return (await isGoogleServiceEnabled(accountId, 'sheets')) || (await canBrowseSheets(accountId))
}

/**
 * A Data Store table's Google Sheet links.
 *
 * GET    — the links (export, import, two-way sync) with their status.
 * PUT    — set one up: a picked spreadsheet (and tab), or — for export and
 *          sync — a new spreadsheet the CRM creates.
 * PATCH  — import's "keep in sync every 15 minutes".
 * POST   — run now: { action: 'export_all' | 'import_now' | 'sync_now'
 *          | 'apply_deletions' | 'keep_deleted' | 'convert_import' }.
 * DELETE — ?direction=export|import|sync removes that link (the sheet stays).
 */

type Direction = 'export' | 'import' | 'sync'
const isDirection = (v: unknown): v is Direction => v === 'export' || v === 'import' || v === 'sync'

async function guard(tableId: string) {
  const ctx = await requireRole('admin')
  await ensureGoogleTables()
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: ctx.accountId },
    select: { id: true, name: true },
  })
  return { ctx, table }
}

function presentSync(link: Awaited<ReturnType<typeof prisma.googleSheetLink.findFirst>>, linkedRows: number) {
  if (!link) return null
  const pinging = Boolean(link.instant_ping_at && Date.now() - link.instant_ping_at.getTime() < 24 * 60 * 60_000)
  return {
    id: link.id,
    spreadsheet_name: link.spreadsheet_name,
    sheet_title: link.sheet_title,
    url: spreadsheetUrl(link.spreadsheet_id),
    linked_rows: linkedRows,
    held: link.held_deletes.length,
    instant: pinging,
    last_synced_at: link.last_synced_at,
    last_error: link.last_error,
    warning: link.sync_warning,
    stats: link.sync_stats,
  }
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
    const syncLink = links.find((l) => l.direction === 'sync') ?? null
    const linkedRows = syncLink ? await prisma.googleSheetRow.count({ where: { link_id: syncLink.id } }) : 0
    return NextResponse.json({
      connected: await sheetsUsable(ctx.accountId),
      can_pick: Boolean(conn?.api_key) && (await isGoogleServiceEnabled(ctx.accountId, 'sheets')),
      can_browse: await canBrowseSheets(ctx.accountId),
      can_write: await canWriteSheets(ctx.accountId),
      google_email: conn?.google_email ?? null,
      export: present(links.find((l) => l.direction === 'export') ?? null),
      import: present(links.find((l) => l.direction === 'import') ?? null),
      sync: presentSync(syncLink, linkedRows),
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
    if (!(await sheetsUsable(ctx.accountId))) {
      return NextResponse.json({ error: 'Connect Google Sheets first, in Settings → Google.' }, { status: 400 })
    }
    const body = (await req.json().catch(() => ({}))) as {
      direction?: unknown
      spreadsheet_id?: unknown
      sheet_title?: unknown
      create_new?: unknown
      auto_sync?: unknown
      columns?: unknown
    }
    if (!isDirection(body.direction)) return NextResponse.json({ error: 'direction must be export, import or sync.' }, { status: 400 })
    const direction = body.direction
    if (direction === 'sync' && !(await canWriteSheets(ctx.accountId))) {
      return NextResponse.json(
        { error: 'Two-way sync needs permission to change the sheet. Connect "Google Sheets — two-way sync" in Settings → Google.', needs_write: true },
        { status: 400 },
      )
    }
    const token = await googleAccessToken(ctx.accountId)

    let spreadsheetId: string
    let spreadsheetName: string
    let sheetTitle: string
    let newSheetMap: Record<string, string> | null = null
    if (body.create_new === true) {
      if (direction === 'import') {
        return NextResponse.json({ error: 'A new sheet can only be created for sending records out or for two-way sync.' }, { status: 400 })
      }
      const created = await createSpreadsheet(token, `${table.name} — CRM`, 'Records')
      spreadsheetId = created.id
      spreadsheetName = created.title
      sheetTitle = created.tabs[0]?.title ?? 'Records'
      if (direction === 'sync') {
        // Every field that can live in a cell becomes a column, by label.
        const fields = await prisma.dataField.findMany({
          where: { table_id: id },
          orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
          select: { field_key: true, label: true, field_type: true },
        })
        newSheetMap = {}
        for (const f of fields) {
          if (NOT_SYNCED.has(f.field_type)) continue
          let label = f.label.trim() || f.field_key
          while (label in newSheetMap || label.toLowerCase() === ID_HEADER.toLowerCase()) label = `${label} (${f.field_key})`
          newSheetMap[label] = f.field_key
        }
        if (Object.keys(newSheetMap).length === 0) {
          return NextResponse.json({ error: 'This table has no fields a sheet can hold yet. Add a field first.' }, { status: 400 })
        }
        await writeTab(token, spreadsheetId, sheetTitle, [[...Object.keys(newSheetMap), ID_HEADER]])
      }
    } else {
      const sid = typeof body.spreadsheet_id === 'string' ? body.spreadsheet_id.trim() : ''
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(sid)) {
        return NextResponse.json({ error: 'Choose a spreadsheet first.' }, { status: 400 })
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
    const other =
      direction === 'sync'
        ? null
        : await prisma.googleSheetLink.findUnique({
            where: { table_id_direction: { table_id: id, direction: direction === 'export' ? 'import' : 'export' } },
          })
    if (other && other.spreadsheet_id === spreadsheetId && other.sheet_title === sheetTitle) {
      return NextResponse.json(
        { error: 'That tab is already used the other way for this table. Use a different tab or spreadsheet.' },
        { status: 400 },
      )
    }

    // Import: each column into a field — chosen on the import screen, or
    // matched by name with a new field for the rest — so a sheet can go
    // into a table that has no fields yet.
    let columnMap: Record<string, string> | null = newSheetMap
    if (direction === 'import' || (direction === 'sync' && !newSheetMap)) {
      let choices: ColumnChoice[]
      if (Array.isArray(body.columns)) {
        choices = (body.columns as unknown[]).filter((c): c is ColumnChoice =>
          Boolean(c) && typeof (c as ColumnChoice).header === 'string' && typeof (c as ColumnChoice).target === 'string')
      } else {
        const preview = await previewSpreadsheet(ctx.accountId, spreadsheetId, sheetTitle).catch(() => null)
        const fields = await prisma.dataField.findMany({ where: { table_id: id }, select: { field_key: true, label: true, field_type: true } })
        choices = preview ? suggestColumns(preview.headers, preview.sample, fields) : []
      }
      // The sync's own id column is never a field.
      choices = choices.map((c) => (c.header.trim().toLowerCase() === ID_HEADER.toLowerCase() ? { ...c, target: 'skip' } : c))
      if (choices.length && choices.every((c) => c.target === 'skip')) {
        return NextResponse.json({ error: 'Choose at least one column to import.' }, { status: 400 })
      }
      if (choices.length) columnMap = await applyColumnChoices(ctx.accountId, id, choices)
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
        ...(columnMap ? { column_map: columnMap } : {}),
      },
      update: {
        spreadsheet_id: spreadsheetId,
        spreadsheet_name: spreadsheetName,
        sheet_title: sheetTitle,
        last_error: null,
        // A different sheet is a fresh start: nothing from it imported yet.
        imported_keys: [],
        ...(columnMap ? { column_map: columnMap } : {}),
        ...(direction === 'import' && typeof body.auto_sync === 'boolean' ? { auto_sync: body.auto_sync } : {}),
      },
    })
    if (direction === 'export') await writeExportHeader(link.id, ctx.accountId)
    if (direction === 'sync') {
      // Two-way replaces one-way on this table: an import would bring rows
      // in twice, an export to the same tab would append them twice.
      await prisma.googleSheetLink.deleteMany({ where: { table_id: id, account_id: ctx.accountId, direction: 'import' } })
      await prisma.googleSheetLink.deleteMany({
        where: { table_id: id, account_id: ctx.accountId, direction: 'export', spreadsheet_id: spreadsheetId, sheet_title: sheetTitle },
      })
      // A different sheet is a fresh start: nothing linked yet.
      await prisma.googleSheetRow.deleteMany({ where: { link_id: link.id } })
      await prisma.googleSheetLink.update({ where: { id: link.id }, data: { held_deletes: [], last_error: null, sync_warning: null } })
      const synced = await runSheetSync(link.id, ctx.accountId)
      return NextResponse.json({ link: present(link), synced })
    }
    // The rows come in now, not on a second click.
    const imported = direction === 'import' ? await importFromSheet(link.id, ctx.accountId).catch((err) => ({ error: err instanceof Error ? err.message : String(err) })) : null
    return NextResponse.json({ link: present(link), imported })
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

    // ── Two-way sync ──────────────────────────────────────────────────
    if (body.action === 'convert_import') {
      // The import link becomes two-way: same sheet, same columns. Rows it
      // already brought in are matched to their records by value, so the
      // first sync links them instead of duplicating them.
      if (!(await canWriteSheets(ctx.accountId))) {
        return NextResponse.json(
          { error: 'Two-way sync needs permission to change the sheet. Connect "Google Sheets — two-way sync" in Settings → Google.', needs_write: true },
          { status: 400 },
        )
      }
      const imp = await prisma.googleSheetLink.findFirst({ where: { table_id: id, account_id: ctx.accountId, direction: 'import' } })
      if (!imp) return NextResponse.json({ error: 'There is no import sheet to turn into two-way sync.' }, { status: 400 })
      const sync = await prisma.googleSheetLink.upsert({
        where: { table_id_direction: { table_id: id, direction: 'sync' } },
        create: {
          account_id: ctx.accountId,
          table_id: id,
          direction: 'sync',
          spreadsheet_id: imp.spreadsheet_id,
          spreadsheet_name: imp.spreadsheet_name,
          sheet_title: imp.sheet_title,
          ...(imp.column_map ? { column_map: imp.column_map } : {}),
        },
        update: {
          spreadsheet_id: imp.spreadsheet_id,
          spreadsheet_name: imp.spreadsheet_name,
          sheet_title: imp.sheet_title,
          ...(imp.column_map ? { column_map: imp.column_map } : {}),
          held_deletes: [],
          last_error: null,
          sync_warning: null,
        },
      })
      await prisma.googleSheetRow.deleteMany({ where: { link_id: sync.id } })
      await prisma.googleSheetLink.deleteMany({ where: { id: imp.id, account_id: ctx.accountId } })
      return NextResponse.json(await runSheetSync(sync.id, ctx.accountId))
    }
    if (body.action === 'sync_now' || body.action === 'apply_deletions' || body.action === 'keep_deleted') {
      const sync = await prisma.googleSheetLink.findFirst({ where: { table_id: id, account_id: ctx.accountId, direction: 'sync' } })
      if (!sync) return NextResponse.json({ error: 'Turn on two-way sync first.' }, { status: 400 })
      if (body.action === 'keep_deleted') {
        // "Put them back": the held records are no longer linked to a row,
        // so the next sync adds them to the sheet again. Nothing deleted.
        await prisma.googleSheetRow.deleteMany({ where: { link_id: sync.id, record_id: { in: sync.held_deletes } } })
        await prisma.googleSheetLink.update({ where: { id: sync.id }, data: { held_deletes: [] } })
      }
      const result = await runSheetSync(sync.id, ctx.accountId, { allowDeletes: body.action === 'apply_deletions' })
      if (!result.ok) return NextResponse.json({ error: result.error ?? 'The sync did not finish.' }, { status: 400 })
      return NextResponse.json(result)
    }

    const direction: Direction | null = body.action === 'export_all' ? 'export' : body.action === 'import_now' ? 'import' : null
    if (!direction) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
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
    if (!isDirection(direction)) return NextResponse.json({ error: 'direction must be export, import or sync.' }, { status: 400 })
    await prisma.googleSheetLink.deleteMany({ where: { table_id: id, account_id: ctx.accountId, direction } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
