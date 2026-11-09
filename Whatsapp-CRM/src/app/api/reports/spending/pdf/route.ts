import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { audit, auditCtx } from '@/lib/audit'
import { readAccountFile } from '@/lib/files/account-files'
import { imageProblem } from '@/lib/files/image-size'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { loadSpending } from '@/lib/reports/spending'
import { buildSpendingPdf, type PdfBusiness } from '@/lib/reports/pdf/spending-pdf'
import { isValidReportLanguage } from '@/lib/countries'

/** A PDF builds the whole report and holds it in memory: a few a minute is plenty. */
const PDF_LIMIT = { limit: 6, windowMs: 60_000 }
const MAX_LOGO_BYTES = 2 * 1024 * 1024

/**
 * GET /api/reports/spending/pdf?period=today|week|month|custom&from=&to=
 *
 * The Spending report as a PDF in the business's report language, with its
 * name, address, tax number and logo at the top and the CRM's name on every
 * page. Same door as the screen: supervisors and above with the Reports page,
 * never an agent. The business, the logo and the language come from the
 * signed-in session's own account, never from the request.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/reports')
    const limit = checkRateLimit(`spending-pdf:${ctx.userId}`, PDF_LIMIT)
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

    // The logo: this business's own file, checked whole again before it is used.
    let logo: PdfBusiness['logo'] = null
    if (extra?.logo_file_id) {
      const file = await readAccountFile(ctx.accountId, extra.logo_file_id, MAX_LOGO_BYTES).catch(() => null)
      if (file && (file.mime === 'image/png' || file.mime === 'image/jpeg') && !imageProblem(file.mime, file.bytes)) {
        logo = { bytes: file.bytes, mime: file.mime }
      }
    }

    const place = [company?.address, company?.city, company?.state, company?.country].filter(Boolean).join(', ')
    const contact = [company?.phone, company?.email].filter(Boolean).join(' · ')
    const business: PdfBusiness = {
      name: company?.display_name || company?.legal_name || account?.name || '',
      lines: [place, contact].filter(Boolean),
      taxId: extra?.tax_id ?? null,
      logo,
    }
    const language = isValidReportLanguage(extra?.report_language) ? extra.report_language : 'en'

    let pdf: Buffer
    try {
      pdf = await buildSpendingPdf({
        report: { ...spending, period: { firstDay: period.firstDay, lastDay: period.lastDay, partial: period.partial, timeZone: tz } },
        business,
        language,
        generatedAt: now,
        timeZone: tz,
      })
    } catch (err) {
      console.error('[spending-pdf] build failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'Could not build the PDF right now. Try again in a minute.' }, { status: 500 })
    }

    // What was taken and for which days; never the amounts.
    await audit(auditCtx(req, ctx), {
      action: 'export.downloaded',
      target: { type: 'report', label: 'Spending report' },
      meta: { format: 'pdf', kind: period.kind, period: `${period.firstDay} to ${period.lastDay}`, language },
    })

    // firstDay/lastDay are YYYY-MM-DD from resolvePeriod: safe in a header.
    const days = period.firstDay === period.lastDay ? period.firstDay : `${period.firstDay}-to-${period.lastDay}`
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="spending-${days}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not prepare the PDF right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
