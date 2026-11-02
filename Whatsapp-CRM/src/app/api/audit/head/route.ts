/**
 * GET /api/audit/head — the audit chains' heads, for the off-server check
 * (scripts/audit/external-verify.ts, run in GitHub Actions). No user
 * session: it is listed in proxy.ts's PUBLIC_PATHS, and this bearer check
 * against AUDIT_HEAD_TOKEN (compared in constant time) is what secures it.
 *
 * Returns per account only { account_id, last_seq, last_hash,
 * last_checkpoint_seq } — no names, no events. The optional
 * ?at=<account-uuid>:<seq> (repeatable, max 50) adds that account's
 * row_hash at one seq, so the checker can compare the part of the chain
 * it already holds even when the server has moved on.
 */

import { timingSafeEqual, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { clientIpKey } from '@/lib/net/client-ip'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function tokenOk(supplied: string, expected: string): boolean {
  // Hash both sides first: equal lengths for timingSafeEqual, and the
  // token's length is not revealed by an early return.
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b) && supplied.length > 0
}

export async function GET(request: Request) {
  const limited = checkRateLimit(`audithead:${clientIpKey(request.headers)}`, { limit: 20, windowMs: 60_000 })
  if (!limited.success) return rateLimitResponse(limited)

  const expected = (process.env.AUDIT_HEAD_TOKEN ?? '').trim()
  if (expected.length < 32) {
    return NextResponse.json({ error: 'The audit head check is not set up on this server' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!tokenOk(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const at = new URL(request.url).searchParams.getAll('at').slice(0, 50)
  const asks: Array<{ acc: string; seq: string }> = []
  for (const a of at) {
    const [acc, seq] = a.split(':')
    if (!UUID.test(acc ?? '') || !/^\d{1,18}$/.test(seq ?? '')) {
      return NextResponse.json({ error: 'at must be <account-id>:<seq>' }, { status: 400 })
    }
    asks.push({ acc: acc.toLowerCase(), seq })
  }

  try {
    const heads = await prisma.$queryRaw<Array<{ account_id: string; last_seq: string; last_hash: string; last_checkpoint_seq: string | null }>>(Prisma.sql`
      SELECT h.account_id::text AS account_id, h.last_seq::text AS last_seq, h.last_hash,
             (SELECT max(c.through_seq) FROM audit_checkpoints c WHERE c.account_id = h.account_id)::text AS last_checkpoint_seq
        FROM audit_chain_heads h
       ORDER BY h.account_id`)
    const hashAt = new Map<string, { seq: string; hash: string | null }>()
    for (const q of asks) {
      const r = await prisma.$queryRaw<Array<{ row_hash: string }>>(Prisma.sql`
        SELECT row_hash FROM audit_events WHERE account_id = ${q.acc}::uuid AND seq = ${q.seq}::bigint LIMIT 1`)
      hashAt.set(q.acc, { seq: q.seq, hash: r[0]?.row_hash ?? null })
    }
    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        accounts: heads.map((h) => ({
          account_id: h.account_id,
          last_seq: h.last_seq,
          last_hash: h.last_hash,
          last_checkpoint_seq: h.last_checkpoint_seq,
          ...(hashAt.has(h.account_id) ? { hash_at: hashAt.get(h.account_id) } : {}),
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[audit/head] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not read the audit chain heads' }, { status: 500 })
  }
}
