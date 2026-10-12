import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { GoogleNotConnectedError } from '@/lib/google/oauth'
import { canBrowseSheets, listSpreadsheets, previewSpreadsheet } from '@/lib/google/sheet-browse'
import { suggestColumns } from '@/lib/google/sheet-sync'
import { SheetsApiError } from '@/lib/google/sheets'

/**
 * The import screen's data.
 *
 *   ?search=…&page=…            — the account's spreadsheets, newest first
 *   ?spreadsheet=ID[&tab=Name]  — its tabs, the tab's first rows, and a
 *                                 suggested field for every column
 *
 * { needs_permission: true } when "Google Sheets — browse all" is not
 * granted, so the screen can offer to connect it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const table = await prisma.dataTable.findFirst({ where: { id, account_id: ctx.accountId }, select: { id: true } })
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    if (!(await canBrowseSheets(ctx.accountId))) return NextResponse.json({ needs_permission: true })

    const sp = req.nextUrl.searchParams
    const spreadsheet = sp.get('spreadsheet')
    if (!spreadsheet) {
      return NextResponse.json(await listSpreadsheets(ctx.accountId, { search: sp.get('search') ?? '', pageToken: sp.get('page') ?? undefined }))
    }
    const [preview, fields] = await Promise.all([
      previewSpreadsheet(ctx.accountId, spreadsheet, sp.get('tab')),
      prisma.dataField.findMany({
        where: { table_id: id },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        select: { field_key: true, label: true, field_type: true },
      }),
    ])
    return NextResponse.json({
      ...preview,
      sample: preview.sample.slice(0, 6),
      fields: fields.filter((f) => !['section_header', 'html_block', 'signature', 'file', 'image'].includes(f.field_type)),
      columns: suggestColumns(preview.headers, preview.sample, fields),
    })
  } catch (err) {
    if (err instanceof SheetsApiError) return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
