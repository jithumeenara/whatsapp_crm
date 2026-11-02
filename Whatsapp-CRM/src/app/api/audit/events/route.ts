import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  buildWhere, decodeCursor, encodeCursor, EVENT_SELECT, filtersFromSearch, LIST_ORDER, parseLimit, present, resolveScope,
} from '@/lib/audit/read'
import { recordAuditViewOncePerDay } from '@/lib/audit/viewed'

/**
 * GET /api/audit/events — the account's audit log, newest first.
 * Admin and owner only (never an API key or MCP: requireRole, not
 * requireRoleOrApiKey). Cursor paging by (occurred_at, id).
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const sp = new URL(req.url).searchParams
    const accountId = await resolveScope(ctx, sp.get('scope'))

    const filters = filtersFromSearch(sp)
    if (!filters.ok) return NextResponse.json({ error: filters.error }, { status: 400 })
    const cursor = decodeCursor(sp.get('cursor'))
    if (!cursor.ok) return NextResponse.json({ error: cursor.error }, { status: 400 })
    const limit = parseLimit(sp.get('limit'))
    if (!limit.ok) return NextResponse.json({ error: limit.error }, { status: 400 })

    const rows = await prisma.auditEvent.findMany({
      where: buildWhere(accountId, filters.value, cursor.value),
      orderBy: LIST_ORDER,
      take: limit.value + 1,
      select: EVENT_SELECT,
    })
    const page = rows.slice(0, limit.value)
    const last = page[page.length - 1]
    const next = rows.length > limit.value && last ? encodeCursor({ at: last.occurred_at, id: last.id }) : null

    if (!cursor.value) await recordAuditViewOncePerDay(req, ctx, { scope: accountId === ctx.accountId ? 'account' : 'platform' })

    return NextResponse.json(
      { events: await present(page), next_cursor: next },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
