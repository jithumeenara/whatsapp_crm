import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { EVENT_SELECT, parseEventId, present, resolveScope } from '@/lib/audit/read'

const NEIGHBOURS = 50

/**
 * GET /api/audit/events/:id — one event and its neighbours from the same
 * request and the same operation. Another account's id gets the same 404
 * as an id that does not exist.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const accountId = await resolveScope(ctx, new URL(req.url).searchParams.get('scope'))
    const { id: raw } = await params
    const id = parseEventId(raw)
    const notFound = NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (id === null) return notFound

    const event = await prisma.auditEvent.findFirst({ where: { id, account_id: accountId }, select: EVENT_SELECT })
    if (!event) return notFound

    const [sameRequest, sameOperation] = await Promise.all([
      event.request_id
        ? prisma.auditEvent.findMany({
            where: { account_id: accountId, request_id: event.request_id, NOT: { id: event.id } },
            orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
            take: NEIGHBOURS,
            select: EVENT_SELECT,
          })
        : Promise.resolve([]),
      event.correlation_id
        ? prisma.auditEvent.findMany({
            where: { account_id: accountId, correlation_id: event.correlation_id, NOT: { id: event.id } },
            orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
            take: NEIGHBOURS,
            select: EVENT_SELECT,
          })
        : Promise.resolve([]),
    ])

    const all = await present([event, ...sameRequest, ...sameOperation])
    return NextResponse.json(
      {
        event: all[0],
        same_request: all.slice(1, 1 + sameRequest.length),
        same_operation: all.slice(1 + sameRequest.length),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
