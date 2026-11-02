import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { businessTimezone } from '@/lib/ai/human-date'
import { filtersFromSearch, MAX_SEARCH_DAYS, resolveScope } from '@/lib/audit/read'

const DAY_MS = 86_400_000

/**
 * GET /api/audit/summary?from&to — totals for the period and where the
 * chain stands. Only from/to are used; the period is capped so the counts
 * never scan months of rows.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const sp = new URL(req.url).searchParams
    const accountId = await resolveScope(ctx, sp.get('scope'))
    const parsed = filtersFromSearch(sp)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { from, to } = parsed.value
    if (to.getTime() - from.getTime() > MAX_SEARCH_DAYS * DAY_MS) {
      return NextResponse.json({ error: `Totals cover at most ${MAX_SEARCH_DAYS} days — pick a shorter period` }, { status: 400 })
    }

    const [counts, head, checkpoint, timezone] = await Promise.all([
      prisma.$queryRaw<Array<{ events: number; failed_logins: number; denied: number; config_changes: number; exports: number }>>(Prisma.sql`
        SELECT count(*)::int AS events,
               count(*) FILTER (WHERE action IN ('auth.login_fail', 'auth.mfa_fail'))::int AS failed_logins,
               count(*) FILTER (WHERE outcome = 'denied')::int AS denied,
               count(*) FILTER (WHERE category = 'config')::int AS config_changes,
               count(*) FILTER (WHERE category = 'export' OR action = 'access.audit_exported')::int AS exports
          FROM audit_events
         WHERE account_id = ${accountId}::uuid AND occurred_at >= ${from} AND occurred_at < ${to}`),
      prisma.auditChainHead.findUnique({ where: { account_id: accountId }, select: { last_seq: true, updated_at: true } }),
      prisma.auditCheckpoint.findFirst({
        where: { account_id: accountId },
        orderBy: { through_seq: 'desc' },
        select: { through_seq: true, created_at: true },
      }),
      businessTimezone(ctx.accountId),
    ])
    const c = counts[0] ?? { events: 0, failed_logins: 0, denied: 0, config_changes: 0, exports: 0 }

    return NextResponse.json(
      {
        counts: c,
        integrity: {
          head_seq: head ? head.last_seq.toString() : null,
          head_updated_at: head ? head.updated_at.toISOString() : null,
          last_checkpoint_seq: checkpoint ? checkpoint.through_seq.toString() : null,
          last_checkpoint_at: checkpoint ? checkpoint.created_at.toISOString() : null,
        },
        timezone,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
