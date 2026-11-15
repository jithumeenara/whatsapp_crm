import { NextRequest, NextResponse } from 'next/server'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { audit, auditCtx } from '@/lib/audit'
import { tryAcquirePdfSlot } from '@/lib/reports/pdf/build-slots'
import { resolveQuery } from '@/lib/reports/doc/period-query'
import { accessFor, findReport, MEMBER_ID, type ExportFormat, type ReportDef } from '@/lib/reports/doc/registry'
import { loadDocBusiness } from '@/lib/reports/doc/business'
import { docToPdf } from '@/lib/reports/doc/pdf'
import { docToXlsx } from '@/lib/reports/doc/xlsx'
import { docToPptx } from '@/lib/reports/doc/pptx'
import { findMember } from '@/lib/reports/doc/member'

/** Viewing switches periods often; an export builds a file. */
const VIEW_LIMIT = { limit: 40, windowMs: 60_000 }
const EXPORT_LIMIT = { limit: 8, windowMs: 60_000 }

const FILE: Record<ExportFormat, { type: string; ext: string }> = {
  pdf: { type: 'application/pdf', ext: 'pdf' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
}

type Subject = { userId: string; name: string | null; self: boolean }

/**
 * Whose numbers, for one person's report card. Below supervisor it is
 * always their own (a member in the address is ignored); a supervisor
 * may open anyone's in this business, and only this business.
 */
async function cardFor(
  def: ReportDef, ownId: string | null, member: string | null, accountId: string,
): Promise<{ userId: string | null; subject: Subject | null } | NextResponse> {
  if (!def.memberCard) return { userId: ownId, subject: null }
  if (ownId) return { userId: ownId, subject: { userId: ownId, name: null, self: true } }
  if (!member) return { userId: null, subject: null }
  if (!MEMBER_ID.test(member)) return NextResponse.json({ error: 'That team member link is not valid.' }, { status: 400 })
  const found = await findMember(accountId, member)
  if (!found) return NextResponse.json({ error: "That person isn't on this team." }, { status: 404 })
  return { userId: found.userId, subject: { userId: found.userId, name: found.name, self: false } }
}

/**
 * GET /api/reports/doc/[key]?period=…&from=&to=&compare=previous|year|none&format=json|pdf|xlsx|pptx
 *
 * One report as a ReportDoc (format=json, the default) or as a file. Who
 * may open it, whose numbers it holds and whether it may be exported are
 * decided by the registry from the role — never from the request. Exports
 * are audited without their figures and share the PDF build limit.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    assertPageAccess(ctx, '/reports')
    const { key } = await params
    const def = findReport(key)
    if (!def) return NextResponse.json({ error: 'There is no such report.' }, { status: 404 })
    const access = accessFor(def, { userId: ctx.userId, role: ctx.role })
    if (!access.allowed) return NextResponse.json({ error: "You don't have access to this report." }, { status: 403 })

    const q = req.nextUrl.searchParams
    const formatParam = q.get('format') ?? 'json'
    if (!['json', 'pdf', 'xlsx', 'pptx'].includes(formatParam)) return NextResponse.json({ error: 'Choose PDF, Excel or PowerPoint.' }, { status: 400 })
    const format = formatParam as 'json' | ExportFormat
    if (format !== 'json' && !access.canExport) return NextResponse.json({ error: 'Only supervisors and above can download reports.' }, { status: 403 })

    const limit = checkRateLimit(`report-doc:${format === 'json' ? 'view' : 'export'}:${ctx.userId}`, format === 'json' ? VIEW_LIMIT : EXPORT_LIMIT)
    if (!limit.success) return rateLimitResponse(limit)

    const tz = await businessTimezone(ctx.accountId)
    const now = new Date()
    const resolved = resolveQuery({ period: q.get('period'), from: q.get('from'), to: q.get('to'), compare: q.get('compare') }, now, tz)
    if (!resolved) return NextResponse.json({ error: 'Choose a start and end date in order, up to one year apart, not in the future.' }, { status: 400 })

    const card = await cardFor(def, access.userId, q.get('member'), ctx.accountId)
    if (card instanceof NextResponse) return card
    const { userId, subject } = card

    const doc = await def.build(
      { accountId: ctx.accountId, userId, role: ctx.role, tz, now, q: resolved, subject },
      { canSeeMoney: access.canSeeMoney },
    )
    if (format === 'json') return NextResponse.json({ doc })

    const { business, language } = await loadDocBusiness(ctx.accountId)
    // A build uses a CPU for seconds; PDFs, slides and workbooks share one limit.
    const release = tryAcquirePdfSlot()
    if (!release) return NextResponse.json({ error: 'Other reports are being built right now. Try again in a few seconds.' }, { status: 503, headers: { 'Retry-After': '5' } })
    let file: Buffer
    try {
      const input = { doc, business, language, generatedAt: now }
      file = format === 'pdf' ? await docToPdf(input) : format === 'xlsx' ? await docToXlsx(input) : await docToPptx(input)
    } catch (err) {
      console.error('[report-doc] build failed:', key, format, err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'Could not build the file right now. Try again in a minute.' }, { status: 500 })
    } finally {
      release()
    }

    await audit(auditCtx(req, ctx), {
      action: 'export.downloaded',
      target: { type: 'report', label: def.title },
      meta: { format, report: key, kind: resolved.kind, compare: resolved.compare, period: `${resolved.period.firstDay} to ${resolved.period.lastDay}`, language },
    })

    // Dates come from resolveQuery (YYYY-MM-DD) and the key from the registry: safe in a header.
    const days = resolved.period.firstDay === resolved.period.lastDay ? resolved.period.firstDay : `${resolved.period.firstDay}-to-${resolved.period.lastDay}`
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': FILE[format].type,
        'Content-Disposition': `attachment; filename="${def.key}-report-${days}.${FILE[format].ext}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    const res = toErrorResponse(err)
    if (res.status === 500) return NextResponse.json({ error: 'Could not prepare the report right now. Try again in a minute.' }, { status: 500 })
    return res
  }
}
