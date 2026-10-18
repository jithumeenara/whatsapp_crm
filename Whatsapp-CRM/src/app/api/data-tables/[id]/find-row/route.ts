import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { findContactRows, phoneKey, pickRows, type WhichRow } from '@/lib/data-store/contact-rows'

/**
 * POST /api/data-tables/[id]/find-row   { phone, match_field, which }
 *
 * The chatbot builder's "Test with a number": which row(s) an "Update
 * table row" step would change for this number. Reads only. Admins only —
 * it looks rows up by phone number.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { phone?: unknown; match_field?: unknown; which?: unknown } | null
    const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 40) : ''
    if (!phoneKey(phone)) return NextResponse.json({ error: 'Enter a full number — at least 10 digits.' }, { status: 400 })
    const which: WhichRow = body?.which === 'oldest' || body?.which === 'all' ? body.which : 'latest'

    const table = await ctx.db.dataTable.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, fields: { select: { field_key: true, label: true, field_type: true } } },
    })
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    const matchField = typeof body?.match_field === 'string' && body.match_field ? body.match_field : null
    if (matchField && !table.fields.some((f) => f.field_key === matchField)) {
      return NextResponse.json({ error: 'That column is not in this table.' }, { status: 400 })
    }
    if (!matchField) {
      return NextResponse.json({ found: 0, rows: [], note: 'Without a phone column only rows the bot saved for a chat match — test it in a real chat.' })
    }

    const rows = await findContactRows({ accountId: ctx.accountId, tableId: table.id, contactId: null, contactPhone: phone, matchField })
    const chosen = pickRows(rows, which)
    // Only the first few columns, for recognising the row — not the whole record.
    const shown = table.fields.filter((f) => !['password', 'file', 'image', 'signature', 'section_header', 'html_block'].includes(f.field_type)).slice(0, 4)
    return NextResponse.json({
      found: rows.length,
      rows: chosen.slice(0, 5).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        preview: shown.map((f) => ({ label: f.label, value: r.data[f.field_key] == null ? '' : String(r.data[f.field_key]).slice(0, 60) })),
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
