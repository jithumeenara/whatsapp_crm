import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { verifyAccountChain } from '@/lib/audit/verify'
import { audit } from '@/lib/audit/write'
import { auditCtx } from '@/lib/audit/context'
import { checkRateLimit } from '@/lib/rate-limit'

/** A full walk reads every event of the account: a few per ten minutes. */
const VERIFY_LIMIT = { limit: 5, windowMs: 10 * 60_000 }

/**
 * POST /api/audit/verify — owner only. Walks this account's chain from the
 * start (or, after retention, from the signed checkpoint just before the
 * oldest event kept) and says whether every row still links and hashes.
 * The check is itself recorded, pass or fail.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireRole('owner')
    // Per account: several owners' tabs cannot multiply the cost.
    const limit = checkRateLimit(`audit:verify:${ctx.accountId}`, VERIFY_LIMIT)
    if (!limit.success) {
      const wait = Math.max(1, Math.ceil((limit.reset - Date.now()) / 60_000))
      return NextResponse.json(
        { error: `The audit log was checked ${VERIFY_LIMIT.limit} times in the last 10 minutes. Try again in about ${wait} minute${wait === 1 ? '' : 's'}.` },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))) } },
      )
    }
    const r = await verifyAccountChain(ctx.accountId)
    await audit(auditCtx(req, ctx), {
      action: 'access.audit_verified',
      outcome: r.ok ? 'success' : 'failure',
      target: { type: 'audit_log' },
      meta: { rows: r.rows, last_seq: r.lastSeq, broken_at_seq: r.brokenAtSeq ?? null, why: r.why ?? null, started_after_seq: r.startedAfterSeq ?? null },
    })
    return NextResponse.json(
      { ok: r.ok, rows: r.rows, lastSeq: r.lastSeq, brokenAtSeq: r.brokenAtSeq ?? null, why: r.why ?? null, message: r.message ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
