import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { parseRuleInput } from '@/lib/google/sheet-route-input'
import type { RouteField } from '@/lib/google/sheet-route-rules'

/**
 * PATCH — change a rule: the whole rule, or only { enabled }.
 * DELETE — remove a rule. Rows it already put in sheets stay there;
 *          the CRM only stops sending.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id, routeId } = await params
    const route = await prisma.sheetRoute.findFirst({ where: { id: routeId, table_id: id, account_id: ctx.accountId }, select: { id: true, is_fallback: true } })
    if (!route) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (body && Object.keys(body).length === 1 && typeof body.enabled === 'boolean') {
      await prisma.sheetRoute.update({ where: { id: route.id }, data: { enabled: body.enabled } })
      return NextResponse.json({ ok: true })
    }
    const fields = await prisma.dataField.findMany({ where: { table_id: id, account_id: ctx.accountId }, select: { field_key: true, label: true, field_type: true, options: true } })
    const parsed = parseRuleInput(body, fields as RouteField[])
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    if (parsed.rule.is_fallback && !route.is_fallback && (await prisma.sheetRoute.count({ where: { table_id: id, is_fallback: true } })) > 0) {
      return NextResponse.json({ error: 'This table already has an “Others” rule.' }, { status: 400 })
    }
    await prisma.sheetRoute.update({ where: { id: route.id }, data: { ...parsed.rule, conditions: parsed.rule.conditions as unknown as Prisma.InputJsonValue, columns: parsed.rule.columns as unknown as Prisma.InputJsonValue, last_error: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id, routeId } = await params
    const n = await prisma.sheetRoute.deleteMany({ where: { id: routeId, table_id: id, account_id: ctx.accountId } })
    if (n.count === 0) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
