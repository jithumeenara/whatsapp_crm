/**
 * The audit chain's hash. One language only (here), over every column but
 * row_hash, as sorted-key JSON so field boundaries are unambiguous and the
 * order Postgres returns JSONB keys in does not matter. Pure.
 */

import crypto from 'crypto'
import { stableJson } from '@/lib/admin-chat/rules'

export interface ChainRow {
  id: bigint | string
  seq: bigint | string
  account_id: string
  occurred_at: Date | string
  ingested_at: Date | string
  actor_type: string
  actor_id: string | null
  actor_label: string | null
  actor_role: string | null
  on_behalf_of: string | null
  action: string
  category: string
  outcome: string
  reason: string | null
  target_type: string | null
  target_id: string | null
  target_label: string | null
  changes: unknown
  request_id: string | null
  correlation_id: string | null
  source: string
  ip: string | null
  user_agent: string | null
  meta: unknown
  prev_hash: string
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

export function genesisHash(accountId: string): string {
  return crypto.createHash('sha256').update(`audit:${accountId}`).digest('hex')
}

export function rowHash(r: ChainRow): string {
  const canonical = stableJson({
    id: String(r.id),
    seq: String(r.seq),
    account_id: r.account_id,
    occurred_at: iso(r.occurred_at),
    ingested_at: iso(r.ingested_at),
    actor_type: r.actor_type,
    actor_id: r.actor_id ?? null,
    actor_label: r.actor_label ?? null,
    actor_role: r.actor_role ?? null,
    on_behalf_of: r.on_behalf_of ?? null,
    action: r.action,
    category: r.category,
    outcome: r.outcome,
    reason: r.reason ?? null,
    target_type: r.target_type ?? null,
    target_id: r.target_id ?? null,
    target_label: r.target_label ?? null,
    changes: r.changes ?? null,
    request_id: r.request_id ?? null,
    correlation_id: r.correlation_id ?? null,
    source: r.source,
    ip: r.ip ?? null,
    user_agent: r.user_agent ?? null,
    meta: r.meta ?? null,
    prev_hash: r.prev_hash,
  })
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

/** Walks rows (in seq order) and names the first that does not fit. */
export function checkChain(
  accountId: string,
  rows: Array<ChainRow & { row_hash: string }>,
  start: { seq: bigint; hash: string } = { seq: BigInt(0), hash: genesisHash(accountId) },
): { ok: true; lastSeq: bigint; lastHash: string } | { ok: false; brokenAtSeq: string; why: 'gap' | 'link' | 'hash' } {
  let prevSeq = start.seq
  let prevHash = start.hash
  for (const r of rows) {
    const seq = BigInt(r.seq)
    if (seq !== prevSeq + BigInt(1)) return { ok: false, brokenAtSeq: seq.toString(), why: 'gap' }
    if (r.prev_hash !== prevHash) return { ok: false, brokenAtSeq: seq.toString(), why: 'link' }
    if (rowHash(r) !== r.row_hash) return { ok: false, brokenAtSeq: seq.toString(), why: 'hash' }
    prevSeq = seq
    prevHash = r.row_hash
  }
  return { ok: true, lastSeq: prevSeq, lastHash: prevHash }
}
