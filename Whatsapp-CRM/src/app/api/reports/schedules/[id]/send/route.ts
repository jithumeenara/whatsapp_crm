import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { audit, auditCtx } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { findReport } from '@/lib/reports/doc/registry'
import { sendScheduledReport } from '@/lib/reports/schedule/sweep'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Sends cost money (WhatsApp templates) and build files: a few a time. */
const SEND_LIMIT = { limit: 3, windowMs: 10 * 60_000 }
/** One send per schedule at a time: a double press is one send. */
const inFlight = new Set<string>()

/**
 * POST /api/reports/schedules/[id]/send — send this schedule now, to try
 * it. The same recipients and checks as the scheduled send; the next
 * scheduled send is not moved.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/reports')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'There is no such schedule.' }, { status: 404 })
    const limit = checkRateLimit(`report-schedule-send:${ctx.userId}`, SEND_LIMIT)
    if (!limit.success) return rateLimitResponse(limit)
    const row = await prisma.scheduledReport.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!row) return NextResponse.json({ error: 'There is no such schedule.' }, { status: 404 })
    if (inFlight.has(id)) return NextResponse.json({ error: 'This report is already being sent.' }, { status: 409 })
    inFlight.add(id)
    let result: string
    try {
      const tz = await businessTimezone(ctx.accountId)
      result = await sendScheduledReport(row, new Date(), tz)
    } catch (err) {
      console.error('[scheduled-reports] send now failed:', id, err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'Could not send it right now. Try again in a minute.' }, { status: 500 })
    } finally {
      inFlight.delete(id)
    }
    await prisma.scheduledReport.updateMany({ where: { id, account_id: ctx.accountId }, data: { last_result: result.slice(0, 500) } })
    await audit(auditCtx(req, ctx), {
      action: 'export.downloaded',
      target: { type: 'scheduled_report', id, label: findReport(row.report_key)?.title ?? row.report_key },
      meta: { via: 'send_now', chat: row.by_chat, email: row.by_email, recipients: row.recipient_ids.length },
    })
    return NextResponse.json({ result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
