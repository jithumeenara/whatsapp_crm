import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

/**
 * After retention archives the oldest rows, the chain check must start
 * from a SIGNED checkpoint that ends exactly before the lowest row kept —
 * never from seq 1 (which would call every retained chain broken) and
 * never from an unsigned guess (which would let a forged start pass).
 */

const h = vi.hoisted(() => ({
  rows: [] as Array<{ seq: bigint | string }>,
  head: null as null | { last_seq: bigint; last_hash: string },
  checkpoints: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    auditEvent: {
      findFirst: async () => (h.rows.length ? { seq: h.rows[0].seq } : null),
      findMany: async ({ where, take }: { where: { seq: { gt: bigint } }; take: number }) =>
        h.rows.filter((r) => (r.seq as bigint) > where.seq.gt).slice(0, take),
    },
    auditChainHead: { findUnique: async () => h.head },
    auditCheckpoint: {
      findMany: async ({ where }: { where: { through_seq: bigint } }) => h.checkpoints.filter((c) => c.through_seq === where.through_seq),
    },
  },
}))

import { genesisHash, rowHash, type ChainRow } from './hash'
import { signCheckpoint } from './offsite/checkpoint'
import { auditPublicKey, verifyAccountChain } from './verify'

const ACC = '11111111-1111-4111-8111-111111111111'

function chain(n: number): Array<ChainRow & { row_hash: string }> {
  const out: Array<ChainRow & { row_hash: string }> = []
  let prev = genesisHash(ACC)
  for (let i = 1; i <= n; i++) {
    const r: ChainRow = {
      id: BigInt(100 + i), seq: BigInt(i), account_id: ACC,
      occurred_at: new Date(Date.UTC(2026, 0, i)), ingested_at: new Date(Date.UTC(2026, 0, i)),
      actor_type: 'system', actor_id: null, actor_label: null, actor_role: null, on_behalf_of: null,
      action: 'system.boot', category: 'system', outcome: 'success', reason: null,
      target_type: null, target_id: null, target_label: null, changes: null,
      request_id: null, correlation_id: null, source: 'system', ip: null, user_agent: null, meta: { i }, prev_hash: prev,
    }
    const row_hash = rowHash(r)
    out.push({ ...r, row_hash })
    prev = row_hash
  }
  return out
}

const keys = crypto.generateKeyPairSync('ed25519')
const pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const other = crypto.generateKeyPairSync('ed25519')

function checkpointFor(row: { seq: unknown; row_hash: string }, privateKey = keys.privateKey) {
  const c = signCheckpoint(
    { account_id: ACC, through_seq: String(row.seq), through_hash: row.row_hash, row_count: String(row.seq), created_at: '2026-02-01T00:00:00.000Z' },
    privateKey,
  )
  // As Prisma returns the row.
  return { ...c, id: BigInt(1), through_seq: BigInt(c.through_seq), row_count: BigInt(c.row_count), created_at: new Date(c.created_at) }
}

let full: ReturnType<typeof chain>
beforeEach(() => {
  full = chain(6)
  h.rows = full
  h.head = { last_seq: BigInt(6), last_hash: full[5].row_hash }
  h.checkpoints = []
  vi.stubEnv('AUDIT_PUBLIC_KEY', pem)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

/** Retention archived seq 1..3: rows 4..6 remain. */
const archiveFirstThree = () => { h.rows = full.slice(3) }

describe('verifyAccountChain', () => {
  it('walks a complete chain from genesis', async () => {
    const r = await verifyAccountChain(ACC)
    expect(r).toEqual(expect.objectContaining({ ok: true, rows: 6, lastSeq: '6', startedAfterSeq: '0' }))
  })

  it('after retention, starts from the signed checkpoint just before the lowest row kept', async () => {
    archiveFirstThree()
    h.checkpoints = [checkpointFor(full[2])]
    const r = await verifyAccountChain(ACC)
    expect(r).toEqual(expect.objectContaining({ ok: true, rows: 3, lastSeq: '6', startedAfterSeq: '3' }))
  })

  it('accepts the key as base64 of the raw 32 bytes too', async () => {
    const jwk = keys.publicKey.export({ format: 'jwk' }) as { x: string }
    vi.stubEnv('AUDIT_PUBLIC_KEY', Buffer.from(jwk.x, 'base64url').toString('base64'))
    expect(auditPublicKey()?.asymmetricKeyType).toBe('ed25519')
    archiveFirstThree()
    h.checkpoints = [checkpointFor(full[2])]
    expect((await verifyAccountChain(ACC)).ok).toBe(true)
  })

  it('refuses to vouch for the start when there is no public key', async () => {
    vi.stubEnv('AUDIT_PUBLIC_KEY', '')
    archiveFirstThree()
    h.checkpoints = [checkpointFor(full[2])]
    const r = await verifyAccountChain(ACC)
    expect(r).toEqual(expect.objectContaining({ ok: false, why: 'archived_start_unverified', brokenAtSeq: '4' }))
    expect(r.message).toMatch(/AUDIT_PUBLIC_KEY/)
  })

  it('refuses when no checkpoint ends right before the lowest row kept', async () => {
    archiveFirstThree()
    h.checkpoints = [checkpointFor(full[1])] // ends at 2, not 3
    const r = await verifyAccountChain(ACC)
    expect(r).toEqual(expect.objectContaining({ ok: false, why: 'archived_start_unverified' }))
    expect(r.message).toMatch(/no signed checkpoint/)
  })

  it('refuses a checkpoint signed by another key, or changed after signing', async () => {
    archiveFirstThree()
    h.checkpoints = [checkpointFor(full[2], other.privateKey)]
    expect((await verifyAccountChain(ACC)).why).toBe('archived_start_unverified')
    h.checkpoints = [{ ...checkpointFor(full[2]), through_hash: 'f'.repeat(64) }]
    expect((await verifyAccountChain(ACC)).why).toBe('archived_start_unverified')
  })

  it('still finds a changed row after a checkpoint start', async () => {
    archiveFirstThree()
    h.checkpoints = [checkpointFor(full[2])]
    h.rows = h.rows.map((r) => (r.seq === BigInt(5) ? { ...r, target_label: 'changed' } : r))
    const r = await verifyAccountChain(ACC)
    expect(r).toEqual(expect.objectContaining({ ok: false, why: 'hash', brokenAtSeq: '5' }))
  })

  it('does not pass when rows after the newest checkpoint were also removed (4 and 5 gone)', async () => {
    h.rows = full.slice(5)
    h.checkpoints = [checkpointFor(full[2])] // signed, but ends at 3 — row 6 needs a start at 5
    expect((await verifyAccountChain(ACC)).why).toBe('archived_start_unverified')
  })
})
