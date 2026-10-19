import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { parseRuleInput } from '@/lib/google/sheet-route-input'
import { describeConditions, type RouteField } from '@/lib/google/sheet-route-rules'
import { spreadsheetUrl } from '@/lib/google/sheets'

/**
 * Sheet routing for one Data Store table (admins).
 *   GET  — the rules with their delivery report, the queue, the fields.
 *   POST — a new rule. The first rule switches routing on for the table
 *          from now on; rows already there are sent only on "Send
 *          existing rows".
 *   PUT  { mode } — first match only / every match;
 *        { order: [ruleId…] } — the order rules are checked in.
 */

async function loadTable(id: string, accountId: string) {
  return prisma.dataTable.findFirst({
    where: { id, account_id: accountId },
    select: { id: true, name: true, fields: { orderBy: { sort_order: 'asc' }, select: { field_key: true, label: true, field_type: true, options: true } } },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const table = await loadTable(id, ctx.accountId)
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    const [state, routes, queue, failed] = await Promise.all([
      prisma.sheetRouteTable.findUnique({ where: { table_id: id } }),
      prisma.sheetRoute.findMany({ where: { table_id: id, account_id: ctx.accountId }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] }),
      prisma.sheetJob.groupBy({ by: ['status'], where: { table_id: id, account_id: ctx.accountId }, _count: { _all: true } }),
      prisma.sheetJob.findFirst({ where: { table_id: id, account_id: ctx.accountId, status: 'failed' }, orderBy: { updated_at: 'desc' }, select: { last_error: true } }),
    ])
    const placed = routes.length
      ? await prisma.sheetRouteRow.groupBy({ by: ['route_id'], where: { route_id: { in: routes.map((r) => r.id) } }, _count: { _all: true } })
      : []
    const count = (s: string) => queue.find((q) => q.status === s)?._count._all ?? 0
    const fields = table.fields as RouteField[]
    return NextResponse.json({
      table: { id: table.id, name: table.name },
      mode: state?.mode === 'all' ? 'all' : 'first',
      last_run_at: state?.last_run_at ?? null,
      fields: table.fields.map((f) => ({ field_key: f.field_key, label: f.label, field_type: f.field_type, options: f.options })),
      queue: { pending: count('pending') + count('running'), failed: count('failed'), last_error: failed?.last_error ?? null },
      routes: routes.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        is_fallback: r.is_fallback,
        match: r.match,
        conditions: r.conditions,
        summary: r.is_fallback ? 'Rows no other rule takes' : describeConditions(Array.isArray(r.conditions) ? (r.conditions as never) : [], r.match === 'any' ? 'any' : 'all', fields),
        spreadsheet_id: r.spreadsheet_id,
        spreadsheet_name: r.spreadsheet_name,
        url: spreadsheetUrl(r.spreadsheet_id),
        tab_title: r.tab_title,
        split_template: r.split_template,
        split_into: r.split_into,
        columns: r.columns,
        move_on_edit: r.move_on_edit,
        delivered_count: r.delivered_count,
        in_sheet: placed.find((p) => p.route_id === r.id)?._count._all ?? 0,
        last_delivered_at: r.last_delivered_at,
        last_error: r.last_error,
        last_error_at: r.last_error_at,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const table = await loadTable(id, ctx.accountId)
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    const parsed = parseRuleInput(await req.json().catch(() => null), table.fields as RouteField[])
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const count = await prisma.sheetRoute.count({ where: { table_id: id } })
    if (count >= 50) return NextResponse.json({ error: 'A table can have up to 50 rules.' }, { status: 400 })
    if (parsed.rule.is_fallback && (await prisma.sheetRoute.count({ where: { table_id: id, is_fallback: true } })) > 0) {
      return NextResponse.json({ error: 'This table already has an “Others” rule.' }, { status: 400 })
    }
    await prisma.sheetRouteTable.upsert({
      where: { table_id: id },
      create: { table_id: id, account_id: ctx.accountId, cursor_at: new Date() },
      update: {},
    })
    const created = await prisma.sheetRoute.create({
      data: {
        ...parsed.rule,
        conditions: parsed.rule.conditions as unknown as Prisma.InputJsonValue,
        columns: parsed.rule.columns as unknown as Prisma.InputJsonValue,
        account_id: ctx.accountId, table_id: id, position: count,
      },
      select: { id: true },
    })
    return NextResponse.json({ id: created.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const table = await loadTable(id, ctx.accountId)
    if (!table) return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as { mode?: unknown; order?: unknown } | null
    if (body?.mode === 'first' || body?.mode === 'all') {
      await prisma.sheetRouteTable.upsert({
        where: { table_id: id },
        create: { table_id: id, account_id: ctx.accountId, mode: body.mode, cursor_at: new Date() },
        update: { mode: body.mode },
      })
    }
    if (Array.isArray(body?.order)) {
      const ids = (body.order as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 50)
      for (let i = 0; i < ids.length; i++) {
        await prisma.sheetRoute.updateMany({ where: { id: ids[i], table_id: id, account_id: ctx.accountId }, data: { position: i } })
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
