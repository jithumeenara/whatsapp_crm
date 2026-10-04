import { NextResponse } from 'next/server'
import { requirePageAccess, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { loadContext, parseSpec, runReport, ReportError } from '@/lib/reports/engine'
import { insightsFor } from '@/lib/reports/insights'
import { exportFilename, reportWorkbook } from '@/lib/reports/excel'
import { recordExport } from '@/lib/reports/store'

/**
 * POST /api/reports/export   { spec }  →  .xlsx
 *
 * The report is run again here rather than taken from the browser, so the
 * file can only ever hold what the engine computed for this account. Each
 * export is logged (who, what, when) before the file is returned.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requirePageAccess('/reports', 'supervisor')
    const limited = checkRateLimit(`report-export:${ctx.userId}`, { limit: 20, windowMs: 60_000 })
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => null)) as { spec?: unknown } | null
    const spec = parseSpec(body?.spec)
    const rc = await loadContext(ctx.accountId)
    const result = await runReport(rc, spec)
    const insights = insightsFor(result)

    const [account, profile] = await Promise.all([
      prisma.account.findUnique({ where: { id: ctx.accountId }, select: { name: true } }),
      prisma.companyProfile.findFirst({ where: { account_id: ctx.accountId }, select: { display_name: true, legal_name: true } }),
    ])
    const accountName = profile?.display_name || profile?.legal_name || account?.name || 'Business'
    const generatedAt = new Intl.DateTimeFormat('en-IN', { timeZone: rc.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date())

    const file = await reportWorkbook(result, insights, { accountName, generatedAt, timezone: rc.timezone })
    await recordExport(ctx.accountId, ctx.userId, 'xlsx', result.title, spec)

    const name = exportFilename(result.title, result.period.from)
    const ascii = name.replace(/[^\x20-\x7E]/g, '_')
    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof ReportError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
