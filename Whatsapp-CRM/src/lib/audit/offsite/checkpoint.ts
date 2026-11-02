/**
 * Signed checkpoints (plan §11): "account X's chain, through seq N, ends
 * in hash H", signed with an Ed25519 key that only the crm-audit Unix
 * user can read. The app never holds the private key, so code running as
 * the app cannot forge one. Pure — keys are passed in.
 *
 * The signed message is the sorted-key JSON (the chain's own stableJson)
 * of exactly the columns stored in audit_checkpoints, so a row read back
 * from the database, an ndjson line and an R2 object all verify the same
 * way.
 */

import crypto, { type KeyObject } from 'crypto'
import { stableJson } from '@/lib/admin-chat/rules'

export interface CheckpointFields {
  account_id: string
  through_seq: string
  through_hash: string
  /** Rows added since the previous checkpoint of this chain. */
  row_count: string
  /** ISO time, millisecond precision. */
  created_at: string
  key_id: string
}

export interface Checkpoint extends CheckpointFields {
  /** Base64 Ed25519 signature over checkpointMessage(fields). */
  signature: string
}

const PREFIX = 'crm-audit-checkpoint:v1\n'

export function checkpointMessage(c: CheckpointFields): string {
  return (
    PREFIX +
    stableJson({
      account_id: c.account_id,
      through_seq: String(c.through_seq),
      through_hash: c.through_hash,
      row_count: String(c.row_count),
      created_at: new Date(c.created_at).toISOString(),
      key_id: c.key_id,
    })
  )
}

function asPrivate(key: KeyObject | string): KeyObject {
  return typeof key === 'string' ? crypto.createPrivateKey(key) : key
}

function asPublic(key: KeyObject | string): KeyObject {
  if (typeof key !== 'string') return key.type === 'private' ? crypto.createPublicKey(key) : key
  return key.includes('PRIVATE KEY') ? crypto.createPublicKey(crypto.createPrivateKey(key)) : crypto.createPublicKey(key)
}

/** SHA-256 of the public key's DER (SPKI) bytes, hex. The same value as
 *  `openssl pkey -pubin -in audit.pub -outform DER | sha256sum`. */
export function keyFingerprint(key: KeyObject | string): string {
  const der = asPublic(key).export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(der).digest('hex')
}

/** Short id stored with each checkpoint: the first 16 hex of the fingerprint. */
export function keyIdOf(key: KeyObject | string): string {
  return keyFingerprint(key).slice(0, 16)
}

/** "ab:cd:…" groups of four for reading aloud / printing. */
export function prettyFingerprint(fp: string): string {
  return fp.match(/.{1,4}/g)?.join(' ') ?? fp
}

export function signCheckpoint(fields: Omit<CheckpointFields, 'key_id'>, privateKey: KeyObject | string): Checkpoint {
  const key = asPrivate(privateKey)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('checkpoint key must be Ed25519')
  const full: CheckpointFields = {
    account_id: fields.account_id,
    through_seq: String(fields.through_seq),
    through_hash: fields.through_hash,
    row_count: String(fields.row_count),
    created_at: new Date(fields.created_at).toISOString(),
    key_id: keyIdOf(key),
  }
  const signature = crypto.sign(null, Buffer.from(checkpointMessage(full), 'utf8'), key).toString('base64')
  return { ...full, signature }
}

/** True only for a checkpoint signed by this key, unchanged in any field. */
export function verifyCheckpoint(c: Checkpoint, publicKey: KeyObject | string): boolean {
  try {
    const key = asPublic(publicKey)
    if (key.asymmetricKeyType !== 'ed25519') return false
    if (c.key_id !== keyIdOf(key)) return false
    return crypto.verify(null, Buffer.from(checkpointMessage(c), 'utf8'), key, Buffer.from(c.signature, 'base64'))
  } catch {
    return false
  }
}

/** Reads a checkpoint from JSON (an ndjson line, an R2 object or a DB row). */
export function parseCheckpoint(v: unknown): Checkpoint | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const s = (x: unknown) => (typeof x === 'string' || typeof x === 'number' || typeof x === 'bigint' ? String(x) : null)
  const created = o.created_at instanceof Date ? o.created_at.toISOString() : s(o.created_at)
  const out = {
    account_id: s(o.account_id),
    through_seq: s(o.through_seq),
    through_hash: s(o.through_hash),
    row_count: s(o.row_count),
    created_at: created,
    key_id: s(o.key_id),
    signature: s(o.signature),
  }
  if (Object.values(out).some((x) => x === null)) return null
  if (!/^\d+$/.test(out.through_seq!) || !/^\d+$/.test(out.row_count!) || Number.isNaN(Date.parse(out.created_at!))) return null
  return out as Checkpoint
}

/** The checkpoint with the highest through_seq for each account (newest wins a tie). */
export function newestByAccount(list: Checkpoint[]): Map<string, Checkpoint> {
  const by = new Map<string, Checkpoint>()
  for (const c of list) {
    const cur = by.get(c.account_id)
    if (!cur || BigInt(c.through_seq) > BigInt(cur.through_seq) || (c.through_seq === cur.through_seq && c.created_at > cur.created_at)) by.set(c.account_id, c)
  }
  return by
}
