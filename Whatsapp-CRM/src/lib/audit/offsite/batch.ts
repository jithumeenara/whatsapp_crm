/**
 * How audit rows are laid out in the off-server copy (plan §20a):
 *
 *   audit/<account>/<yyyy>/<mm>/<from>-<to>.ndjson   rows, one JSON per line
 *   audit/<account>/checkpoints/<through_seq>.json   a signed checkpoint
 *   audit/archive/<yyyy>-<mm>.dump                   a retired partition
 *
 * Seq numbers are zero-padded to 12 digits so a plain listing sorts in
 * chain order. Each object is one contiguous seq range; a new object
 * starts when the month of occurred_at changes or a batch is full. Rows
 * are written exactly as stored (personal values were already masked when
 * the event was written), so their hashes still verify. Pure.
 */

import type { ChainRow } from '../hash'

export type StoredRow = ChainRow & { row_hash: string }

export const MAX_ROWS_PER_OBJECT = 5000
const PAD = 12
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function padSeq(seq: bigint | string | number): string {
  const s = String(seq)
  if (!/^\d+$/.test(s)) throw new Error(`bad seq ${s.slice(0, 20)}`)
  return s.padStart(PAD, '0')
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

function monthOf(d: Date | string): { yyyy: string; mm: string } {
  const s = iso(d)
  return { yyyy: s.slice(0, 4), mm: s.slice(5, 7) }
}

export function rowsObjectKey(accountId: string, firstOccurredAt: Date | string, fromSeq: bigint | string, toSeq: bigint | string): string {
  if (!UUID.test(accountId)) throw new Error('bad account id')
  const { yyyy, mm } = monthOf(firstOccurredAt)
  return `audit/${accountId.toLowerCase()}/${yyyy}/${mm}/${padSeq(fromSeq)}-${padSeq(toSeq)}.ndjson`
}

export function checkpointObjectKey(accountId: string, throughSeq: bigint | string): string {
  if (!UUID.test(accountId)) throw new Error('bad account id')
  return `audit/${accountId.toLowerCase()}/checkpoints/${padSeq(throughSeq)}.json`
}

export function archiveObjectKey(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM')
  return `audit/archive/${month}.dump`
}

export type ParsedKey =
  | { kind: 'rows'; accountId: string; from: bigint; to: bigint }
  | { kind: 'checkpoint'; accountId: string; throughSeq: bigint }

export function parseObjectKey(key: string): ParsedKey | null {
  let m = /^audit\/([0-9a-f-]{36})\/(\d{4})\/(\d{2})\/(\d{12})-(\d{12})\.ndjson$/.exec(key)
  if (m && UUID.test(m[1])) {
    const from = BigInt(m[4])
    const to = BigInt(m[5])
    return to >= from ? { kind: 'rows', accountId: m[1], from, to } : null
  }
  m = /^audit\/([0-9a-f-]{36})\/checkpoints\/(\d{12})\.json$/.exec(key)
  if (m && UUID.test(m[1])) return { kind: 'checkpoint', accountId: m[1], throughSeq: BigInt(m[2]) }
  return null
}

export interface PlannedObject {
  key: string
  from: bigint
  to: bigint
  rows: StoredRow[]
}

/** Splits rows (already in seq order, one account) into objects. */
export function planObjects(accountId: string, rows: StoredRow[], maxRows = MAX_ROWS_PER_OBJECT): PlannedObject[] {
  const out: PlannedObject[] = []
  let cur: StoredRow[] = []
  let curMonth = ''
  let prevSeq: bigint | null = null
  const flush = () => {
    if (!cur.length) return
    const from = BigInt(cur[0].seq)
    const to = BigInt(cur[cur.length - 1].seq)
    out.push({ key: rowsObjectKey(accountId, cur[0].occurred_at, from, to), from, to, rows: cur })
    cur = []
  }
  for (const r of rows) {
    if (r.account_id !== accountId) throw new Error('row from another account in the batch')
    const { yyyy, mm } = monthOf(r.occurred_at)
    const month = `${yyyy}-${mm}`
    // Checked against the previous row, not the current object: a gap that
    // falls exactly on a month change must not slip through.
    const seq = BigInt(r.seq)
    if (prevSeq !== null && seq !== prevSeq + BigInt(1)) throw new Error('rows are not contiguous')
    prevSeq = seq
    if (cur.length && (month !== curMonth || cur.length >= maxRows)) flush()
    curMonth = month
    cur.push(r)
  }
  flush()
  return out
}

const FIELDS = [
  'id', 'seq', 'account_id', 'occurred_at', 'ingested_at', 'actor_type', 'actor_id', 'actor_label', 'actor_role',
  'on_behalf_of', 'action', 'category', 'outcome', 'reason', 'target_type', 'target_id', 'target_label', 'changes',
  'request_id', 'correlation_id', 'source', 'ip', 'user_agent', 'meta', 'prev_hash', 'row_hash',
] as const

/** One stored row as one line: every hashed column, ids as strings, times ISO. */
export function rowToLine(r: StoredRow): string {
  const o: Record<string, unknown> = {}
  for (const f of FIELDS) {
    const v = (r as unknown as Record<string, unknown>)[f]
    if (f === 'id' || f === 'seq') o[f] = String(v)
    else if (f === 'occurred_at' || f === 'ingested_at') o[f] = iso(v as Date | string)
    else o[f] = v === undefined ? null : v
  }
  return JSON.stringify(o)
}

export function toNdjson(rows: StoredRow[]): string {
  return rows.map(rowToLine).join('\n') + '\n'
}

export function fromNdjson(text: string): StoredRow[] {
  const out: StoredRow[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const o = JSON.parse(line) as Record<string, unknown>
    for (const f of FIELDS) if (!(f in o)) throw new Error(`line is missing ${f}`)
    out.push(o as unknown as StoredRow)
  }
  return out
}
