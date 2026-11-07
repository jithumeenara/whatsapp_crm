import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/** Each download builds the whole report: a few a minute is plenty for a person. */
const EXPORT_LIMIT = { limit: 10, windowMs: 60_000 }
import { businessTimezone } from '@/lib/ai/human-date'
import { audit, auditCtx } from '@/lib/audit'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { buildSummary } from '@/lib/reports/summary'
import { actions, headline } from '@/lib/reports/headline'
import { buildReportWorkbook } from '@/lib/reports/excel'

const WORD: Record<string, string> = { today: 'today', week: 'this week', month: 'this month', custom: 'in these days' }

/**
 * GET /api/reports/export?period=today|week|month|custom&from=&to=
 *
 * The team report as an Excel file. Supervisors and above only: an agent
 * gets no export, not even of their own numbers (decided with the owner),
 * so the role is checked before anything is read.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/reports')
    const limit = checkRateLimit(`reports-export:${ctx.userId}`, EXPORT_LIMIT)
    if (!limit.success) return rateLimitResponse(limit)

    const q = req.nextUrl.searchParams
    const kind = q.get('period') ?? 'week'
    let input: PeriodInput
    if (kind === 'custom') input = { kind, from: q.get('from') ?? '', to: q.get('to') ?? '' }
    else if (kind === 'today' || kind === 'week' || kind === 'month') input = { kind }
    else return NextResponse.json({ error: 'Choose today, this week, this month or your own dates.' }, { status: 400 })

    const tz = await businessTimezone(ctx.accountId)
    const now = new Date()
    const period = resolvePeriod(input, now, tz)
    if (!period) return NextResponse.json({ error: 'Choose a start and end date in order, up to one year apart.' }, { status: 400 })

    const summary = await buildSummary({ accountId: ctx.accountId, userId: null, period, now, tz })
    const wb = buildReportWorkbook({
      summary,
      period,
      headline: headline(summary, WORD[period.kind]),
      actions: actions(summary),
      timeZone: tz,
    })
    const buffer = await wb.xlsx.writeBuffer()

    // What was taken and for which days; never the numbers themselves.
    await audit(auditCtx(req, ctx), {
      action: 'export.downloaded',
      target: { type: 'report', label: 'Owner report' },
      meta: { format: 'xlsx', kind: period.kind, period: `${period.firstDay} to ${period.lastDay}` },
    })

    // firstDay/lastDay are YYYY-MM-DD from resolvePeriod: safe in a header.
    const days = period.firstDay === period.lastDay ? period.firstDay : `${period.firstDay}-to-${period.lastDay}`
    // exceljs's Buffer type does not match this project's @types/node
    // Buffer generic; Uint8Array is a valid body either way.
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="report-${days}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
