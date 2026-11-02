/**
 * Read-only access to the audit chain for the crm-audit scripts, through
 * the crm_audit_reader login (SELECT on the audit tables, INSERT on
 * audit_checkpoints and nothing else — docs/deploy/audit-role-split.sql).
 */

import { Client } from 'pg'
import { checkChain, genesisHash } from '../../../src/lib/audit/hash'
import type { StoredRow } from '../../../src/lib/audit/offsite/batch'
import type { Checkpoint } from '../../../src/lib/audit/offsite/checkpoint'

export interface Head {
  account_id: string
  last_seq: string
  last_hash: string
}

export async function connect(dbUrl: string): Promise<Client> {
  const c = new Client({ connectionString: dbUrl, application_name: 'crm-audit', statement_timeout: 120_000 })
  await c.connect()
  return c
}

/** A consistent read: heads and rows from one snapshot. */
export async function readOnlySnapshot<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const r = await fn()
    await c.query('COMMIT')
    return r
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  }
}

export async function readHeads(c: Client): Promise<Head[]> {
  const r = await c.query<Head>('SELECT account_id::text, last_seq::text, last_hash FROM audit_chain_heads ORDER BY account_id')
  return r.rows
}

export async function readRows(c: Client, accountId: string, afterSeq: bigint, throughSeq: bigint, limit = 2000): Promise<StoredRow[]> {
  const r = await c.query(
    `SELECT id::text, seq::text, account_id::text, occurred_at, ingested_at, actor_type, actor_id, actor_label, actor_role,
            on_behalf_of::text, action, category, outcome, reason, target_type, target_id, target_label, changes,
            request_id, correlation_id, source, ip, user_agent, meta, prev_hash, row_hash
       FROM audit_events WHERE account_id = $1::uuid AND seq > $2::bigint AND seq <= $3::bigint
      ORDER BY seq LIMIT $4`,
    [accountId, afterSeq.toString(), throughSeq.toString(), limit],
  )
  return r.rows as StoredRow[]
}

export async function minSeq(c: Client, accountId: string): Promise<bigint | null> {
  const r = await c.query<{ s: string | null }>('SELECT min(seq)::text AS s FROM audit_events WHERE account_id = $1::uuid', [accountId])
  return r.rows[0]?.s ? BigInt(r.rows[0].s) : null
}

export type WalkResult =
  | { ok: true; seq: bigint; hash: string; rows: number; hashes: Map<string, string> }
  | { ok: false; brokenAtSeq: string; why: string; rows: number }

/**
 * Walks a chain from a known point (genesis by default) up to a seq,
 * remembering the row hash at the seqs asked for in `want`.
 */
export async function walk(
  c: Client,
  accountId: string,
  throughSeq: bigint,
  start: { seq: bigint; hash: string } = { seq: BigInt(0), hash: genesisHash(accountId) },
  want: Set<string> = new Set(),
): Promise<WalkResult> {
  let cur = start
  let rows = 0
  const hashes = new Map<string, string>()
  if (want.has(cur.seq.toString())) hashes.set(cur.seq.toString(), cur.hash)
  while (cur.seq < throughSeq) {
    const batch = await readRows(c, accountId, cur.seq, throughSeq)
    if (!batch.length) return { ok: false, brokenAtSeq: (cur.seq + BigInt(1)).toString(), why: 'missing rows', rows }
    const r = checkChain(accountId, batch, cur)
    if (!r.ok) return { ok: false, brokenAtSeq: r.brokenAtSeq, why: r.why, rows: rows + batch.length }
    for (const row of batch) if (want.has(String(row.seq))) hashes.set(String(row.seq), row.row_hash)
    rows += batch.length
    cur = { seq: r.lastSeq, hash: r.lastHash }
  }
  return { ok: true, seq: cur.seq, hash: cur.hash, rows, hashes }
}

export async function insertCheckpoint(c: Client, cp: Checkpoint): Promise<void> {
  await c.query(
    `INSERT INTO audit_checkpoints (account_id, through_seq, through_hash, row_count, created_at, signature, key_id)
     VALUES ($1::uuid, $2::bigint, $3, $4::bigint, $5::timestamptz, $6, $7)`,
    [cp.account_id, cp.through_seq, cp.through_hash, cp.row_count, cp.created_at, cp.signature, cp.key_id],
  )
}

export async function defaultPartitionRows(c: Client): Promise<number | null> {
  try {
    const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_events_default')
    return r.rows[0]?.n ?? 0
  } catch {
    return null
  }
}
