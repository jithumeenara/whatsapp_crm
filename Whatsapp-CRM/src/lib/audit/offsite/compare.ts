/**
 * The off-server check (plan §20a "External verifier"): the copy in R2 is
 * walked as a chain on its own, its newest signed checkpoint must sit on
 * that chain, and the live server must still hold everything the copy
 * holds — at least as long, and the same hash at the copy's last seq.
 *
 * Catches: a row edited on the server (hash at that seq differs), rows
 * removed from the end or a rollback (server shorter than the copy), a
 * forged checkpoint (signature), and uploads that stopped. Pure.
 */

import { checkChain } from '../hash'
import { verifyCheckpoint, type Checkpoint } from './checkpoint'
import { parseObjectKey, type StoredRow } from './batch'

export interface ServerHead {
  account_id: string
  last_seq: string
  last_hash: string
  last_checkpoint_seq: string | null
  /** The server's row_hash at a seq the caller asked about (?at=). */
  hash_at?: { seq: string; hash: string | null } | null
}

export interface OffsiteInput {
  accountId: string
  objects: Array<{ key: string; rows: StoredRow[] }>
  checkpoint: Checkpoint | null
  publicKey: string | null
  server: ServerHead | null
  now: Date
  /** An upload older than this while the server has newer rows is a problem. */
  maxUploadAgeHours?: number
}

export interface OffsiteResult {
  accountId: string
  ok: boolean
  problems: string[]
  notes: string[]
  rows: number
  r2LastSeq: string
  r2LastHash: string | null
}

/** Compares the copy's end with the server's head. Pure; [] when they agree. */
export function compareServerHead(r2Last: { seq: bigint; hash: string | null }, server: ServerHead | null): string[] {
  if (r2Last.seq === BigInt(0)) return []
  if (!server) return [`the server no longer has this chain at all, but the off-server copy holds ${r2Last.seq} rows`]
  const serverSeq = BigInt(server.last_seq)
  if (serverSeq < r2Last.seq) {
    return [`the server's chain is SHORTER than the off-server copy (server ${serverSeq}, copy ${r2Last.seq}) — rows were removed or the database was rolled back`]
  }
  if (serverSeq === r2Last.seq) {
    return server.last_hash === r2Last.hash ? [] : [`the server's hash at seq ${serverSeq} differs from the off-server copy — the chain was rewritten`]
  }
  const at = server.hash_at
  if (!at || at.seq !== r2Last.seq.toString()) return [`the server did not answer for seq ${r2Last.seq}, so the shared part could not be compared`]
  if (at.hash === null) return [`the server has no row at seq ${r2Last.seq}, which the off-server copy holds — a row was removed`]
  if (at.hash !== r2Last.hash) return [`the server's hash at seq ${r2Last.seq} differs from the off-server copy — the chain was rewritten`]
  return []
}

export function verifyOffsite(input: OffsiteInput): OffsiteResult {
  const { accountId } = input
  const problems: string[] = []
  const notes: string[] = []

  // 1. Put the objects together; a seq held twice must be the same row.
  const bySeq = new Map<string, StoredRow>()
  for (const o of input.objects) {
    const k = parseObjectKey(o.key)
    if (!k || k.kind !== 'rows' || k.accountId !== accountId) {
      problems.push(`unexpected object ${o.key}`)
      continue
    }
    const expected = Number(k.to - k.from) + 1
    if (o.rows.length !== expected || (o.rows.length && (BigInt(o.rows[0].seq) !== k.from || BigInt(o.rows[o.rows.length - 1].seq) !== k.to))) {
      problems.push(`object ${o.key} does not hold the rows its name says`)
    }
    for (const r of o.rows) {
      if (r.account_id !== accountId) {
        problems.push(`object ${o.key} holds a row of another account`)
        break
      }
      const seen = bySeq.get(String(r.seq))
      if (seen && seen.row_hash !== r.row_hash) problems.push(`two different copies of seq ${r.seq} in the off-server copy`)
      if (!seen) bySeq.set(String(r.seq), r)
    }
  }
  const rows = [...bySeq.values()].sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1))

  // 2. The copy as a chain on its own, from the account's genesis.
  let r2LastSeq = BigInt(0)
  let r2LastHash: string | null = null
  if (rows.length) {
    const c = checkChain(accountId, rows)
    if (!c.ok) {
      problems.push(`the off-server copy breaks at seq ${c.brokenAtSeq} (${c.why})`)
      // Compare only the part that holds together.
      const good = rows.filter((r) => BigInt(r.seq) < BigInt(c.brokenAtSeq))
      if (good.length) {
        r2LastSeq = BigInt(good[good.length - 1].seq)
        r2LastHash = good[good.length - 1].row_hash
      }
    } else {
      r2LastSeq = c.lastSeq
      r2LastHash = c.lastHash
    }
  }

  // 3. The newest signed checkpoint must be genuine and sit on the chain.
  if (input.checkpoint) {
    const cp = input.checkpoint
    if (cp.account_id !== accountId) problems.push('the newest checkpoint names another account')
    if (input.publicKey) {
      if (!verifyCheckpoint(cp, input.publicKey)) problems.push(`checkpoint at seq ${cp.through_seq} has a BAD SIGNATURE — it was not made by the audit signer`)
    } else {
      notes.push('no public key given: checkpoint signatures were not checked')
    }
    const t = BigInt(cp.through_seq)
    if (t > r2LastSeq) {
      problems.push(`checkpoint at seq ${t} is ahead of the off-server rows (${r2LastSeq}) — rows it covers are missing from the copy`)
    } else if (t > BigInt(0) && bySeq.get(t.toString())?.row_hash !== cp.through_hash) {
      problems.push(`checkpoint at seq ${t} does not match the off-server rows`)
    }
  } else if (rows.length) {
    notes.push('no checkpoint uploaded yet for this chain')
  }

  // 4. The live server must still hold all of it.
  problems.push(...compareServerHead({ seq: r2LastSeq, hash: r2LastHash }, input.server))
  if (input.server && !rows.length && BigInt(input.server.last_seq) > BigInt(0)) {
    problems.push(`the server has ${input.server.last_seq} rows but none were ever uploaded`)
  }

  // 5. Uploads still running: the newest uploaded row is recent, or the server has nothing newer.
  const maxAge = (input.maxUploadAgeHours ?? 26) * 3600_000
  if (rows.length && input.server && BigInt(input.server.last_seq) > r2LastSeq) {
    const last = rows[rows.length - 1]
    const age = input.now.getTime() - new Date(last.ingested_at).getTime()
    if (age > maxAge) problems.push(`uploads stopped: the newest uploaded row is ${Math.round(age / 3600_000)} h old while the server has ${BigInt(input.server.last_seq) - r2LastSeq} newer rows`)
  }

  return { accountId, ok: problems.length === 0, problems, notes, rows: rows.length, r2LastSeq: r2LastSeq.toString(), r2LastHash }
}
