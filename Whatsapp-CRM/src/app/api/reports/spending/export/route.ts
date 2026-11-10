import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { audit, auditCtx } from '@/lib/audit'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { loadSpending } from '@/lib/reports/spending'
import { buildSpendingWorkbook } from '@/lib/reports/spending-excel'

/** Each download builds the whole report: a few a minute is plenty for a person. */
const EXPORT_LIMIT = { limit: 10, windowMs: 60_000 }

/**
 * GET /api/reports/spending/export?period=today|week|month|custom&from=&to=
 *
 * The Spending report as an Excel file. Same door as the screen and the PDF:
 * supervisors and above with the Reports page, never an agent. The business
 * comes from the signed-in session's own account, never from the request.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/reports')
    const limit = checkRateLimit(`spending-export:${ctx.userId}`, EXPORT_LIMIT)
    if (!limit.success) return rateLimitResponse(limit)

    const q = req.nextUrl.searchParams
    const kind = q.get('period') ?? 'month'
    let input: PeriodInput
    if (kind === 'custom') input = { kind, from: q.get('from') ?? '', to: q.get('to') ?? '' }
    else if (kind === 'today' || kind === 'week' || kind === 'month') input = { kind }
    else return NextResponse.json({ error: 'Choose today, this week, this month or your own dates.' }, { status: 400 })

    const tz = await businessTimezone(ctx.accountId)
    const now = new Date()
    const period = resolvePeriod(input, now, tz)
    if (!period) return NextResponse.json({ error: 'Choose a start and end date in order, up to one year apart.' }, { status: 400 })

    const [spending, account, company, extra] = await Promise.all([
      loadSpending({ accountId: ctx.accountId, period, tz }),
      prisma.account.findUnique({ where: { id: ctx.accountId }, select: { name: true } }),
      prisma.companyProfile.findUnique({ where: { account_id: ctx.accountId } }),
      prisma.accountReportProfile.findUnique({ where: { account_id: ctx.accountId } }).catch(() => null),
    ])

    const workbook = buildSpendingWorkbook({
      report: { ...spending, period: { firstDay: period.firstDay, lastDay: period.lastDay, partial: period.partial, timeZone: tz } },
      business: { name: company?.display_name || company?.legal_name || account?.name || '', taxId: extra?.tax_id ?? null },
      generatedAt: now,
      timeZone: tz,
    })
    const buffer = await workbook.xlsx.writeBuffer()

    // What was taken and for which days; never the amounts.
    await audit(auditCtx(req, ctx), {
      action: 'export.downloaded',
      target: { type: 'report', label: 'Spending report' },
      meta: { format: 'xlsx', kind: period.kind, period: `${period.firstDay} to ${period.lastDay}` },
    })

    // firstDay/lastDay are YYYY-MM-DD from resolvePeriod: safe in a header.
    const days = period.firstDay === period.lastDay ? period.firstDay : `${period.firstDay}-to-${period.lastDay}`
    // exceljs's Buffer type does not match this project's @types/node Buffer
    // generic; Uint8Array is a valid body either way.
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="spending-${days}.xlsx"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    // The detail is logged by toErrorResponse; the screen gets plain words.
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not prepare the Excel file right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
