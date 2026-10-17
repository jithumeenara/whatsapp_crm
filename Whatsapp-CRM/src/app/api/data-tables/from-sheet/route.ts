import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { slugify } from '@/lib/data-store/slugify'
import { GoogleNotConnectedError, googleAccessToken } from '@/lib/google/oauth'
import { SheetsApiError, getSpreadsheet } from '@/lib/google/sheets'
import { ensureGoogleTables } from '@/lib/google/store'
import { applyColumnChoices, importFromSheet, type ColumnChoice } from '@/lib/google/sheet-sync'
import { canWriteSheets, runSheetSync } from '@/lib/google/sheet-two-way'
import { ID_HEADER } from '@/lib/google/sheet-two-way-plan'

/**
 * POST /api/data-tables/from-sheet — a Google Sheet tab as a NEW table.
 *
 * Body: { name, spreadsheet_id, sheet_title, columns: ColumnChoice[], two_way }
 *   two_way true  → kept equal both ways (adds, edits, deletions), seconds
 *   two_way false → rows imported now, new rows every 15 minutes
 *
 * One request so a half-made table is never left behind: if the first
 * sync fails, the just-created table — still empty — is removed again.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(`from-sheet:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limited.success) return NextResponse.json({ error: 'Too many imports at once. Try again in a minute.' }, { status: 429 })
    await ensureGoogleTables()

    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown
      spreadsheet_id?: unknown
      sheet_title?: unknown
      columns?: unknown
      two_way?: unknown
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
    if (!name) return NextResponse.json({ error: 'Give the table a name.' }, { status: 400 })
    const spreadsheetId = typeof body.spreadsheet_id === 'string' ? body.spreadsheet_id.trim() : ''
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId)) return NextResponse.json({ error: 'Choose a spreadsheet first.' }, { status: 400 })
    const wantedTab = typeof body.sheet_title === 'string' ? body.sheet_title.trim() : ''
    const twoWay = body.two_way === true
    const choices = (Array.isArray(body.columns) ? (body.columns as unknown[]) : [])
      .filter((c): c is ColumnChoice => Boolean(c) && typeof (c as ColumnChoice).header === 'string' && typeof (c as ColumnChoice).target === 'string')
      .slice(0, 200)
      // The sync's own id column is never a field.
      .map((c) => (c.header.trim().toLowerCase() === ID_HEADER.toLowerCase() ? { ...c, target: 'skip' } : c))
      // A new table has no fields to map onto: anything but "skip" is new.
      .map((c) => (c.target === 'skip' ? c : { ...c, target: 'new' }))
    if (!choices.some((c) => c.target !== 'skip')) return NextResponse.json({ error: 'Choose at least one column to import.' }, { status: 400 })

    if (twoWay && !(await canWriteSheets(ctx.accountId))) {
      return NextResponse.json(
        { error: 'Two-way sync needs permission to change the sheet. Connect "Google Sheets — two-way sync" in Settings → Google.', needs_write: true },
        { status: 400 },
      )
    }

    const token = await googleAccessToken(ctx.accountId)
    const info = await getSpreadsheet(token, spreadsheetId)
    const tab = wantedTab ? info.tabs.find((t) => t.title === wantedTab) : info.tabs[0]
    if (!tab) return NextResponse.json({ error: `That spreadsheet has no tab named "${wantedTab}".` }, { status: 400 })

    // The table, with a free slug (same rule as POST /api/data-tables).
    const baseSlug = slugify(name) || 'table'
    const taken = new Set(
      (await prisma.dataTable.findMany({ where: { account_id: ctx.accountId, slug: { startsWith: baseSlug } }, select: { slug: true } })).map((t) => t.slug),
    )
    let slug = baseSlug
    for (let i = 2; taken.has(slug); i++) slug = `${baseSlug}-${i}`
    const table = await prisma.dataTable.create({
      data: { account_id: ctx.accountId, name, slug, icon: 'chart', description: `From Google Sheet “${info.title}” — ${tab.title}` },
      select: { id: true },
    })

    const removeIfEmpty = async () => {
      const count = await prisma.dataRecord.count({ where: { table_id: table.id, account_id: ctx.accountId } })
      if (count === 0) await prisma.dataTable.deleteMany({ where: { id: table.id, account_id: ctx.accountId } })
    }

    try {
      const columnMap = await applyColumnChoices(ctx.accountId, table.id, choices)
      const link = await prisma.googleSheetLink.create({
        data: {
          account_id: ctx.accountId,
          table_id: table.id,
          direction: twoWay ? 'sync' : 'import',
          spreadsheet_id: spreadsheetId,
          spreadsheet_name: info.title,
          sheet_title: tab.title,
          auto_sync: !twoWay,
          column_map: columnMap,
        },
      })
      if (twoWay) {
        const result = await runSheetSync(link.id, ctx.accountId)
        if (!result.ok) {
          await removeIfEmpty()
          return NextResponse.json({ error: result.error ?? 'The first sync did not finish.' }, { status: 400 })
        }
        return NextResponse.json({ table_id: table.id, two_way: true, stats: result.stats }, { status: 201 })
      }
      const imported = await importFromSheet(link.id, ctx.accountId)
      return NextResponse.json({ table_id: table.id, two_way: false, imported: imported.imported }, { status: 201 })
    } catch (err) {
      await removeIfEmpty().catch(() => {})
      throw err
    }
  } catch (err) {
    if (err instanceof SheetsApiError || err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}
