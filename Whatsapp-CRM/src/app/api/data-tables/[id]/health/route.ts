import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getSelectItems, type FieldConfig, type SelectOption } from '@/lib/data-store/types'
import {
  findHealthIssues,
  mergeChanges,
  monthFixChanges,
  type HealthField,
  type HealthRow,
} from '@/lib/data-store/data-health'
import { invalidateSearchableTables } from '@/lib/ai/table-search-store'
import { scheduleKnowledgeRefresh } from '@/lib/ai/knowledge-refresh'

/**
 * Data health for one table (lib/data-store/data-health.ts): what is
 * spelt several ways, which months disagree with their dates, unreadable
 * dates, empty required cells — and one-click fixes for the first two.
 *
 * Reading is for anybody on the account. Fixing changes many rows at
 * once, so it needs an agent or above; the fix is recomputed here from
 * the rows, so a request can only ever apply a change the report itself
 * would suggest.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A table larger than this is checked on its first rows only. */
const MAX_ROWS = 5000

async function load(accountId: string, tableId: string) {
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: accountId },
    select: {
      id: true,
      fields: {
        orderBy: { sort_order: 'asc' },
        select: { field_key: true, label: true, field_type: true, required: true, options: true },
      },
    },
  })
  if (!table) return null
  const records = await prisma.dataRecord.findMany({
    where: { table_id: tableId, account_id: accountId },
    orderBy: { created_at: 'asc' },
    take: MAX_ROWS,
    select: { id: true, data: true },
  })
  const fields: HealthField[] = table.fields.map((f) => ({
    field_key: f.field_key,
    label: f.label,
    field_type: f.field_type,
    required: f.required,
    options: getSelectItems(f.options as FieldConfig | SelectOption[] | null).flatMap((o) => [o.value, o.label]),
  }))
  const rows: HealthRow[] = records.map((r) => ({ id: r.id, data: (r.data ?? {}) as Record<string, unknown> }))
  return { fields, rows, truncated: records.length >= MAX_ROWS }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    const state = await load(ctx.accountId, id)
    if (!state) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    return NextResponse.json({
      rows: state.rows.length,
      truncated: state.truncated,
      issues: findHealthIssues(state.fields, state.rows),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })

    const body = (await req.json().catch(() => null)) as {
      action?: string
      field_key?: string
      from?: unknown
      to?: unknown
    } | null
    const state = await load(ctx.accountId, id)
    if (!state) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })
    const field = state.fields.find((f) => f.field_key === body?.field_key)
    if (!field) return NextResponse.json({ error: 'That column is not in this table.' }, { status: 400 })

    let changes: Array<{ id: string; data: Record<string, unknown> }>
    if (body?.action === 'merge') {
      const from = Array.isArray(body.from) ? body.from.filter((v): v is string => typeof v === 'string') : []
      if (typeof body.to !== 'string' || !body.to.trim() || from.length === 0) {
        return NextResponse.json({ error: 'Say which spellings to merge, and into which.' }, { status: 400 })
      }
      changes = mergeChanges(field, state.rows, from, body.to)
    } else if (body?.action === 'fix_months') {
      changes = monthFixChanges(state.fields, state.rows, field.field_key)
    } else {
      return NextResponse.json({ error: 'action must be "merge" or "fix_months".' }, { status: 400 })
    }

    // In batches, each row scoped to this account's table as well as its id.
    for (let i = 0; i < changes.length; i += 100) {
      await prisma.$transaction(
        changes.slice(i, i + 100).map((c) =>
          prisma.dataRecord.updateMany({
            where: { id: c.id, table_id: id, account_id: ctx.accountId },
            data: { data: c.data as never },
          }),
        ),
      )
    }
    // The assistant's search reads the table fresh; its knowledge text
    // catches up within a minute.
    invalidateSearchableTables(ctx.accountId)
    if (changes.length > 0) scheduleKnowledgeRefresh(ctx.accountId, id)

    const fresh = await load(ctx.accountId, id)
    return NextResponse.json({
      changed: changes.length,
      rows: fresh?.rows.length ?? 0,
      truncated: fresh?.truncated ?? false,
      issues: fresh ? findHealthIssues(fresh.fields, fresh.rows) : [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
