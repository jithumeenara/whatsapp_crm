import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { audit, auditCtx } from '@/lib/audit'
import { readAccountFile } from '@/lib/files/account-files'
import { imageProblem } from '@/lib/files/image-size'
import { resolvePeriod, type PeriodInput } from '@/lib/reports/period'
import { loadPresentation } from '@/lib/reports/presentation'
import { buildDeck } from '@/lib/reports/pptx/presentation-pptx'
import { tryAcquirePdfSlot } from '@/lib/reports/pdf/build-slots'
import type { PdfBusiness } from '@/lib/reports/pdf/spending-pdf'
import { isValidReportLanguage } from '@/lib/countries'

/** A deck reads Meta and builds the whole report: a few a minute is plenty. */
const DECK_LIMIT = { limit: 6, windowMs: 60_000 }
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/**
 * GET /api/reports/presentation?period=today|week|month|custom&from=&to=
 *
 * The owner's report as slides (.pptx) in the business's colour and
 * language. Same door as the other downloads: supervisors and above with
 * the Reports page, never an agent. Business, logo, language and colour
 * come from the session's own account, never from the request. Counts
 * only for anything about customers.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/reports')
    const limit = checkRateLimit(`deck:${ctx.userId}`, DECK_LIMIT)
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

    const [data, account, company, extra] = await Promise.all([
      loadPresentation({ accountId: ctx.accountId, period, tz, now }),
      prisma.account.findUnique({ where: { id: ctx.accountId }, select: { name: true } }),
      prisma.companyProfile.findUnique({ where: { account_id: ctx.accountId } }),
      prisma.accountReportProfile.findUnique({ where: { account_id: ctx.accountId } }).catch(() => null),
    ])

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

    // Shares the PDF limit: a deck build uses a CPU for seconds too.
    const release = tryAcquirePdfSlot()
    if (!release) {
      return NextResponse.json({ error: 'Other reports are being built right now. Try again in a few seconds.' }, { status: 503, headers: { 'Retry-After': '5' } })
    }
    let deck: Buffer
    try {
      deck = await buildDeck({ data, business, language, generatedAt: now })
    } catch (err) {
      console.error('[deck] build failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'Could not build the slides right now. Try again in a minute.' }, { status: 500 })
    } finally {
      release()
    }

    await audit(auditCtx(req, ctx), {
      action: 'export.downloaded',
      target: { type: 'report', label: 'Leads report slides' },
      meta: { format: 'pptx', kind: period.kind, period: `${period.firstDay} to ${period.lastDay}`, language },
    })

    const days = period.firstDay === period.lastDay ? period.firstDay : `${period.firstDay}-to-${period.lastDay}`
    return new NextResponse(new Uint8Array(deck), {
      headers: {
        'Content-Type': PPTX,
        'Content-Disposition': `attachment; filename="report-${days}.pptx"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not prepare the slides right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
