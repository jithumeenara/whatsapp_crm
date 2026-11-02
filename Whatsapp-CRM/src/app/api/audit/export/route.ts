import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditInTx } from '@/lib/audit/write'
import { auditCtx } from '@/lib/audit/context'
import {
  buildWhere, EVENT_SELECT, filtersForRecord, filtersFromObject, LIST_ORDER, present, resolveScope, type Cursor,
} from '@/lib/audit/read'
import { csvEventLine, csvPreamble, EXPORT_MAX_DAYS, EXPORT_MAX_ROWS, EXPORT_PER_HOUR, type ExportHead } from '@/lib/audit/export'

const BATCH = 1000
const DAY_MS = 86_400_000

/**
 * POST /api/audit/export  { format: 'csv' | 'json', filters?: {...}, scope? }
 *
 * The current filters as a file: at most 50,000 rows and 92 days, three
 * exports an hour per account (counted in the log itself, so a restart or a
 * second admin does not reset it). Rows are cut at the chain head read
 * first, so the file says exactly which seq/hash it runs through.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Send the format and filters as JSON' }, { status: 400 })
    }
    const format = body.format
    if (format !== 'csv' && format !== 'json') return NextResponse.json({ error: 'Format must be csv or json' }, { status: 400 })
    const scope = typeof body.scope === 'string' ? body.scope : null
    const accountId = await resolveScope(ctx, scope)

    const parsed = filtersFromObject(body.filters)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const filters = parsed.value
    if (filters.to.getTime() - filters.from.getTime() > EXPORT_MAX_DAYS * DAY_MS) {
      return NextResponse.json({ error: `An export covers at most ${EXPORT_MAX_DAYS} days — pick a shorter period` }, { status: 400 })
    }

    const head = await prisma.auditChainHead.findUnique({ where: { account_id: accountId } })
    const throughSeq = head?.last_seq ?? BigInt(0)
    const where = { AND: [buildWhere(accountId, filters), { seq: { lte: throughSeq } }] }
    const rows = await prisma.auditEvent.count({ where, take: EXPORT_MAX_ROWS + 1 })
    if (rows > EXPORT_MAX_ROWS) {
      return NextResponse.json(
        { error: `More than ${EXPORT_MAX_ROWS.toLocaleString('en-IN')} events match. Narrow the filters or the period.` },
        { status: 400 },
      )
    }

    const exportHead: ExportHead = {
      through_seq: throughSeq.toString(),
      through_hash: head?.last_hash ?? '',
      cut_at: new Date().toISOString(),
      filters: { ...filtersForRecord(filters), ...(accountId !== ctx.accountId ? { scope: 'platform' } : {}) },
    }

    // Fail closed: the cap check and the record of this export happen in one
    // transaction, under a per-account lock, BEFORE a byte is sent. Two
    // admins clicking at once are serialised; if the record cannot be
    // written, there is no export.
    let allowed: boolean
    try {
      allowed = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit-export:${ctx.accountId}`}))::text`
        // Per account, not per admin: several admins cannot multiply the cap.
        const recent = await tx.auditEvent.count({
          where: {
            account_id: ctx.accountId,
            action: 'access.audit_exported',
            outcome: 'success',
            occurred_at: { gte: new Date(Date.now() - 3_600_000) },
          },
        })
        if (recent >= EXPORT_PER_HOUR) return false
        await auditInTx(tx, auditCtx(req, ctx), {
          action: 'access.audit_exported',
          target: { type: 'audit_log' },
          meta: { rows, format, filters: exportHead.filters, through_seq: exportHead.through_seq },
        })
        return true
      }, { timeout: 10_000, maxWait: 5_000 })
    } catch (err) {
      console.error('[audit export] could not record the export:', err)
      return NextResponse.json(
        { error: 'The export could not be recorded in the audit log, so it was not started. Try again in a minute.' },
        { status: 500 },
      )
    }
    if (!allowed) {
      return NextResponse.json(
        { error: `This account has made ${EXPORT_PER_HOUR} exports in the last hour. Try again later.` },
        { status: 429, headers: { 'Retry-After': '3600' } },
      )
    }

    const enc = new TextEncoder()
    let cursor: Cursor | null = null
    let first = true
    let started = false
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!started) {
            started = true
            controller.enqueue(enc.encode(
              format === 'csv'
                ? csvPreamble(exportHead)
                : `{"through_seq":${JSON.stringify(exportHead.through_seq)},"through_hash":${JSON.stringify(exportHead.through_hash)},"cut_at":${JSON.stringify(exportHead.cut_at)},"filters":${JSON.stringify(exportHead.filters)},"events":[`,
            ))
            return
          }
          const batch = await prisma.auditEvent.findMany({
            where: { AND: [buildWhere(accountId, filters, cursor), { seq: { lte: throughSeq } }] },
            orderBy: LIST_ORDER,
            take: BATCH,
            select: EVENT_SELECT,
          })
          if (batch.length) {
            const out = await present(batch)
            let text = ''
            for (const e of out) {
              if (format === 'csv') text += csvEventLine(e)
              else {
                text += (first ? '' : ',') + JSON.stringify(e)
                first = false
              }
            }
            controller.enqueue(enc.encode(text))
            const last = batch[batch.length - 1]
            cursor = { at: last.occurred_at, id: last.id }
          }
          if (batch.length < BATCH) {
            if (format === 'json') controller.enqueue(enc.encode(']}'))
            controller.close()
          }
        } catch (err) {
          console.error('[audit export] stream failed:', err)
          controller.error(err)
        }
      },
    })

    const stamp = exportHead.cut_at.slice(0, 10)
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${stamp}.${format}"`,
        'Cache-Control': 'no-store',
        'X-Audit-Through-Seq': exportHead.through_seq,
        'X-Audit-Through-Hash': exportHead.through_hash,
        'X-Audit-Rows': String(rows),
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
