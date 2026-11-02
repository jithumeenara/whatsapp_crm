/**
 * Checking a chain against itself and its head, and keeping partitions
 * ahead. The off-server comparison (signed checkpoints, the R2 copy) is
 * done by the crm-audit scripts, which never trust this database alone.
 */

import crypto, { type KeyObject } from 'crypto'
import { prisma } from '@/lib/db'
import { checkChain, genesisHash, type ChainRow } from './hash'
import { parseCheckpoint, verifyCheckpoint } from './offsite/checkpoint'

export interface VerifyResult {
  ok: boolean
  rows: number
  lastSeq: string
  lastHash: string
  brokenAtSeq?: string
  why?: 'gap' | 'link' | 'hash' | 'head' | 'archived_start_unverified'
  /** Plain words for a person, when the reason needs more than the code. */
  message?: string
  /** The seq the walk started after (0 = genesis; higher = a signed checkpoint, after retention). */
  startedAfterSeq?: string
}

/**
 * The server's checkpoint public key from AUDIT_PUBLIC_KEY: a PEM (real or
 * "\n"-escaped newlines), or base64 of the 32 raw Ed25519 bytes or of the
 * SPKI DER. Null when unset or unreadable.
 */
export function auditPublicKey(raw = process.env.AUDIT_PUBLIC_KEY): KeyObject | null {
  const v = raw?.trim()
  if (!v) return null
  try {
    if (v.includes('BEGIN')) return crypto.createPublicKey(v.replace(/\\n/g, '\n'))
    const buf = Buffer.from(v, 'base64')
    if (buf.length === 32) {
      return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: buf.toString('base64url') }, format: 'jwk' })
    }
    return crypto.createPublicKey({ key: buf, format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

/**
 * Where an account's walk starts. From seq 1 when it is still there; after
 * retention archived the oldest rows, from a signed checkpoint that ends
 * exactly before the lowest row kept — never from an unsigned guess.
 */
async function startingPoint(accountId: string): Promise<{ seq: bigint; hash: string } | { why: 'archived_start_unverified'; message: string; atSeq: string }> {
  const genesis = { seq: BigInt(0), hash: genesisHash(accountId) }
  const lowest = await prisma.auditEvent.findFirst({ where: { account_id: accountId }, orderBy: { seq: 'asc' }, select: { seq: true } })
  let anchorSeq: bigint
  if (lowest) {
    if (lowest.seq <= BigInt(1)) return genesis
    anchorSeq = lowest.seq - BigInt(1)
  } else {
    // Every row archived (or none ever written): the head must match a checkpoint.
    const head = await prisma.auditChainHead.findUnique({ where: { account_id: accountId } })
    if (!head || head.last_seq === BigInt(0)) return genesis
    anchorSeq = head.last_seq
  }
  const atSeq = (anchorSeq + BigInt(1)).toString()
  const key = auditPublicKey()
  if (!key) {
    return {
      why: 'archived_start_unverified',
      atSeq,
      message: `Events before #${atSeq} were archived, and this server has no AUDIT_PUBLIC_KEY to check the signed checkpoint they end in. The events kept cannot be proven complete from here.`,
    }
  }
  const candidates = await prisma.auditCheckpoint.findMany({
    where: { account_id: accountId, through_seq: anchorSeq },
    orderBy: { created_at: 'desc' },
    take: 5,
  })
  for (const row of candidates) {
    const c = parseCheckpoint(row)
    if (c && verifyCheckpoint(c, key)) return { seq: anchorSeq, hash: c.through_hash }
  }
  return {
    why: 'archived_start_unverified',
    atSeq,
    message: candidates.length
      ? `Events before #${atSeq} were archived, and no checkpoint ending at #${anchorSeq} carries a valid signature for this server's key.`
      : `Events before #${atSeq} were archived, and there is no signed checkpoint ending at #${anchorSeq} to start the check from.`,
  }
}

/** Walks an account's chain by seq from the start (or from a known point).
 *  After retention, the start is the signed checkpoint just before the
 *  lowest row kept (see startingPoint). */
export async function verifyAccountChain(accountId: string, from?: { seq: bigint; hash: string }): Promise<VerifyResult> {
  const s = from ?? (await startingPoint(accountId))
  if ('why' in s) return { ok: false, rows: 0, lastSeq: '0', lastHash: '', brokenAtSeq: s.atSeq, why: s.why, message: s.message }
  let start = s
  const startedAfterSeq = start.seq.toString()
  let rows = 0
  for (;;) {
    const batch = (await prisma.auditEvent.findMany({
      where: { account_id: accountId, seq: { gt: start.seq } },
      orderBy: { seq: 'asc' },
      take: 1000,
    })) as unknown as Array<ChainRow & { row_hash: string }>
    if (!batch.length) break
    const r = checkChain(accountId, batch, start)
    if (!r.ok) return { ok: false, rows: rows + batch.length, lastSeq: start.seq.toString(), lastHash: start.hash, brokenAtSeq: r.brokenAtSeq, why: r.why, startedAfterSeq }
    rows += batch.length
    start = { seq: r.lastSeq, hash: r.lastHash }
  }
  const head = await prisma.auditChainHead.findUnique({ where: { account_id: accountId } })
  if (head && (head.last_seq !== start.seq || head.last_hash !== start.hash)) {
    return { ok: false, rows, lastSeq: start.seq.toString(), lastHash: start.hash, brokenAtSeq: head.last_seq.toString(), why: 'head', startedAfterSeq }
  }
  return { ok: true, rows, lastSeq: start.seq.toString(), lastHash: start.hash, startedAfterSeq }
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
