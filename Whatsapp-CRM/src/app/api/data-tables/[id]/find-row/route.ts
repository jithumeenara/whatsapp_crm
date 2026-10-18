import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { MATCH_OPS, findRows, normaliseConditions, pickRows, type MatchOp, type WhichRow } from '@/lib/data-store/contact-rows'

/**
 * POST /api/data-tables/[id]/find-row   { conditions: [{ field_key, op, value }], match: 'all' | 'any', which }
 *
 * The chatbot builder's "Test": which row(s) an "Update table row" step
 * would change, with the values typed into the test box in place of the
 * step's variables. Reads only. Admins only — it looks rows up by any
 * column, phone numbers included.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { conditions?: unknown; which?: unknown; match?: unknown; only_this_chat?: unknown } | null
    const onlyThisChat = body?.only_this_chat === true
    const mode = body?.match === 'any' ? 'any' : 'all'
    const which: WhichRow = body?.which === 'oldest' || body?.which === 'all' ? body.which : 'latest'
    const raw = Array.isArray(body?.conditions) ? (body.conditions as Array<Record<string, unknown>>) : []
    const conditions = raw.slice(0, 5).map((c) => ({
      field_key: typeof c.field_key === 'string' ? c.field_key : '',
      op: ((MATCH_OPS as readonly string[]).includes(String(c.op)) ? c.op : 'equals') as MatchOp,
      value: typeof c.value === 'string' ? c.value.slice(0, 500) : '',
    }))

    const table = await ctx.db.dataTable.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, fields: { select: { field_key: true, label: true, field_type: true } } },
    })
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 })

    const norm = normaliseConditions(table.fields, conditions, false, mode)
    if ('error' in norm) return NextResponse.json({ error: norm.error }, { status: 400 })
    if (norm.nothing) return NextResponse.json({ found: 0, rows: [], note: 'A value is empty, or a phone number has fewer than 10 digits — that matches nothing.' })

    const rows = await findRows({ accountId: ctx.accountId, tableId: table.id, conditions: norm.conditions, mode, onlyContactId: null })
    // "Only rows saved for this chat": in a real chat, rows no chat saved
    // (imported, Excel, by hand) are left out. Say how many that is, so the
    // Test never promises a match the chatbot will not make.
    const savedByAChat = rows.filter((r) => r.contact_id).length
    const chatNote = onlyThisChat && rows.length > 0
      ? savedByAChat === 0
        ? `In the chat this would find NOTHING: “Only rows saved for this chat” is on, and ${rows.length === 1 ? 'this row was' : 'these rows were'} imported or added by hand, not saved by a chat. Untick it.`
        : `In the chat only rows saved by that customer’s chat count (${savedByAChat} of ${rows.length} here were saved by a chat).`
      : null
    const chosen = pickRows(rows, which)
    // Only the first few columns, for recognising the row — not the whole record.
    const shown = table.fields
      .filter((f) => !['password', 'file', 'image', 'signature', 'section_header', 'html_block'].includes(f.field_type))
      .slice(0, 4)
    return NextResponse.json({
      found: rows.length,
      chat_note: chatNote,
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
