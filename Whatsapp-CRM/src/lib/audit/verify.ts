/**
 * Checking a chain against itself and its head, and keeping partitions
 * ahead. The off-server comparison (signed checkpoints, the R2 copy) is
 * done by the crm-audit scripts, which never trust this database alone.
 */

import { prisma } from '@/lib/db'
import { checkChain, genesisHash, type ChainRow } from './hash'

export interface VerifyResult {
  ok: boolean
  rows: number
  lastSeq: string
  lastHash: string
  brokenAtSeq?: string
  why?: 'gap' | 'link' | 'hash' | 'head'
}

/** Walks an account's chain by seq from the start (or from a known point). */
export async function verifyAccountChain(accountId: string, from?: { seq: bigint; hash: string }): Promise<VerifyResult> {
  let start = from ?? { seq: BigInt(0), hash: genesisHash(accountId) }
  let rows = 0
  for (;;) {
    const batch = (await prisma.auditEvent.findMany({
      where: { account_id: accountId, seq: { gt: start.seq } },
      orderBy: { seq: 'asc' },
      take: 1000,
    })) as unknown as Array<ChainRow & { row_hash: string }>
    if (!batch.length) break
    const r = checkChain(accountId, batch, start)
    if (!r.ok) return { ok: false, rows: rows + batch.length, lastSeq: start.seq.toString(), lastHash: start.hash, brokenAtSeq: r.brokenAtSeq, why: r.why }
    rows += batch.length
    start = { seq: r.lastSeq, hash: r.lastHash }
  }
  const head = await prisma.auditChainHead.findUnique({ where: { account_id: accountId } })
  if (head && (head.last_seq !== start.seq || head.last_hash !== start.hash)) {
    return { ok: false, rows, lastSeq: start.seq.toString(), lastHash: start.hash, brokenAtSeq: head.last_seq.toString(), why: 'head' }
  }
  return { ok: true, rows, lastSeq: start.seq.toString(), lastHash: start.hash }
}

/** Creates this month's and the next three months' partitions, and reports
 *  any rows in the default partition (a month that was missing). */
export async function maintainAuditPartitions(): Promise<{ defaultRows: number }> {
  const now = new Date()
  for (let i = 0; i <= 3; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 10)
    await prisma.$queryRaw`SELECT audit_ensure_partition(${d}::date)::text`
  }
  const r = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM audit_events_default`
  return { defaultRows: r[0]?.n ?? 0 }
}
