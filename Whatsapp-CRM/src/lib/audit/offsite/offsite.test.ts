import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { EMPTY_SHA256, encodeKeyPath, signRequest } from './sigv4'
import { keyFingerprint, keyIdOf, signCheckpoint, verifyCheckpoint, parseCheckpoint, newestByAccount } from './checkpoint'
import { checkpointObjectKey, fromNdjson, padSeq, parseObjectKey, planObjects, rowsObjectKey, toNdjson, type StoredRow } from './batch'
import { compareServerHead, verifyOffsite, type ServerHead } from './compare'
import { genesisHash, rowHash, type ChainRow } from '../hash'

const ACC = '11111111-2222-4333-8444-555555555555'

function chain(n: number, start = new Date('2026-10-31T23:59:58.000Z'), stepMs = 1000): StoredRow[] {
  const out: StoredRow[] = []
  let prev = genesisHash(ACC)
  for (let i = 1; i <= n; i++) {
    const t = new Date(start.getTime() + (i - 1) * stepMs)
    const r: ChainRow = {
      id: String(100 + i), seq: String(i), account_id: ACC, occurred_at: t, ingested_at: t,
      actor_type: 'user', actor_id: 'u1', actor_label: 'A***', actor_role: 'admin', on_behalf_of: null,
      action: 'lead.update', category: 'data', outcome: 'success', reason: null,
      target_type: 'lead', target_id: String(i), target_label: null, changes: { status: ['new', 'won'] },
      request_id: null, correlation_id: null, source: 'web', ip: '10.0.0.1', user_agent: null, meta: null, prev_hash: prev,
    }
    const h = rowHash(r)
    out.push({ ...r, row_hash: h })
    prev = h
  }
  return out
}

describe('SigV4', () => {
  // AWS SigV4 test suite, "get-vanilla".
  it('matches the get-vanilla vector', () => {
    const r = signRequest(
      { method: 'GET', host: 'example.amazonaws.com', path: '/', payloadHash: EMPTY_SHA256, amzDate: '20150830T123600Z' },
      { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service' },
    )
    expect(r.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31')
    expect(r.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    )
  })

  // Amazon S3 documentation, "Example: GET Object" (header-based auth).
  it('matches the S3 GET Object example', () => {
    const r = signRequest(
      {
        method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', payloadHash: EMPTY_SHA256, amzDate: '20130524T000000Z',
        headers: { range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256 },
      },
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3' },
    )
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })

  it('encodes each key segment once and keeps slashes', () => {
    expect(encodeKeyPath('b', 'audit/x y/a+b.ndjson')).toBe('/b/audit/x%20y/a%2Bb.ndjson')
  })
})

describe('checkpoints (Ed25519)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const fields = { account_id: ACC, through_seq: '42', through_hash: 'a'.repeat(64), row_count: '7', created_at: '2026-11-02T10:00:00.123Z' }

  it('signs and verifies', () => {
    const cp = signCheckpoint(fields, privateKey)
    expect(cp.key_id).toBe(keyIdOf(publicKey))
    expect(keyFingerprint(privateKey)).toBe(keyFingerprint(publicKey))
    expect(verifyCheckpoint(cp, publicKey)).toBe(true)
    // Round-trips through JSON (an ndjson line / R2 object).
    expect(verifyCheckpoint(parseCheckpoint(JSON.parse(JSON.stringify(cp)))!, publicKey)).toBe(true)
  })

  it('refuses a forged or altered checkpoint', () => {
    const cp = signCheckpoint(fields, privateKey)
    expect(verifyCheckpoint({ ...cp, through_seq: '43' }, publicKey)).toBe(false)
    expect(verifyCheckpoint({ ...cp, through_hash: 'b'.repeat(64) }, publicKey)).toBe(false)
    const other = crypto.generateKeyPairSync('ed25519')
    const forged = signCheckpoint(fields, other.privateKey)
    expect(verifyCheckpoint(forged, publicKey)).toBe(false)
    // Even with the right key id copied over, the signature fails.
    expect(verifyCheckpoint({ ...forged, key_id: cp.key_id }, publicKey)).toBe(false)
    expect(verifyCheckpoint({ ...cp, signature: 'AAAA' }, publicKey)).toBe(false)
  })

  it('picks the newest checkpoint per account', () => {
    const a = signCheckpoint({ ...fields, through_seq: '5' }, privateKey)
    const b = signCheckpoint({ ...fields, through_seq: '40' }, privateKey)
    expect(newestByAccount([b, a]).get(ACC)?.through_seq).toBe('40')
  })
})

describe('upload object naming and batching', () => {
  it('names objects by account, month and padded seq range', () => {
    expect(rowsObjectKey(ACC, '2026-11-02T10:00:00Z', BigInt(1), BigInt(500))).toBe(`audit/${ACC}/2026/11/000000000001-000000000500.ndjson`)
    expect(checkpointObjectKey(ACC, '42')).toBe(`audit/${ACC}/checkpoints/000000000042.json`)
    expect(padSeq(7)).toBe('000000000007')
    expect(parseObjectKey(`audit/${ACC}/2026/11/000000000001-000000000500.ndjson`)).toEqual({ kind: 'rows', accountId: ACC, from: BigInt(1), to: BigInt(500) })
    expect(parseObjectKey(`audit/${ACC}/checkpoints/000000000042.json`)).toEqual({ kind: 'checkpoint', accountId: ACC, throughSeq: BigInt(42) })
    expect(parseObjectKey('audit/../etc/passwd')).toBeNull()
    expect(() => rowsObjectKey('../x', new Date(), BigInt(1), BigInt(2))).toThrow()
  })

  it('splits on month change and on the size cap, keeping ranges contiguous', () => {
    const rows = chain(7) // 23:59:58, :59, then five in November
    const objs = planObjects(ACC, rows, 3)
    expect(objs.map((o) => [o.from, o.to])).toEqual([
      [BigInt(1), BigInt(2)],
      [BigInt(3), BigInt(5)],
      [BigInt(6), BigInt(7)],
    ])
    expect(objs[0].key).toContain('/2026/10/')
    expect(objs[1].key).toContain('/2026/11/')
  })

  it('refuses a gap in the batch', () => {
    const rows = chain(3)
    expect(() => planObjects(ACC, [rows[0], rows[2]])).toThrow(/contiguous/)
  })

  it('ndjson round-trips with hashes intact', () => {
    const rows = chain(3)
    const back = fromNdjson(toNdjson(rows))
    expect(back.map((r) => rowHash(r))).toEqual(rows.map((r) => r.row_hash))
  })
})

describe('external verify', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const now = new Date('2026-11-01T00:10:00Z')
  const rows = chain(6)
  const objects = planObjects(ACC, fromNdjson(toNdjson(rows))).map((o) => ({ key: o.key, rows: o.rows }))
  const cp = signCheckpoint({ account_id: ACC, through_seq: '6', through_hash: rows[5].row_hash, row_count: '6', created_at: now.toISOString() }, privateKey)
  const head = (over: Partial<ServerHead>): ServerHead => ({ account_id: ACC, last_seq: '6', last_hash: rows[5].row_hash, last_checkpoint_seq: '6', ...over })

  it('passes when server, copy and checkpoint agree', () => {
    const r = verifyOffsite({ accountId: ACC, objects, checkpoint: cp, publicKey: pub, server: head({}), now })
    expect(r.problems).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('detects a server chain shorter than the copy (rollback / removed rows)', () => {
    const r = verifyOffsite({ accountId: ACC, objects, checkpoint: cp, publicKey: pub, server: head({ last_seq: '4', last_hash: rows[3].row_hash }), now })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/SHORTER/)
  })

  it('detects a mismatched hash at the shared seq', () => {
    const same = verifyOffsite({ accountId: ACC, objects, checkpoint: cp, publicKey: pub, server: head({ last_hash: 'f'.repeat(64) }), now })
    expect(same.ok).toBe(false)
    expect(same.problems.join(' ')).toMatch(/rewritten/)
    const longer = verifyOffsite({ accountId: ACC, objects, checkpoint: cp, publicKey: pub, server: head({ last_seq: '9', last_hash: 'x', hash_at: { seq: '6', hash: 'e'.repeat(64) } }), now })
    expect(longer.ok).toBe(false)
    expect(longer.problems.join(' ')).toMatch(/rewritten/)
  })

  it('accepts a longer server chain whose hash at the copy\'s end matches', () => {
    expect(compareServerHead({ seq: BigInt(6), hash: rows[5].row_hash }, head({ last_seq: '9', last_hash: 'x', hash_at: { seq: '6', hash: rows[5].row_hash } }))).toEqual([])
  })

  it('detects a forged checkpoint and an edited row in the copy', () => {
    const other = crypto.generateKeyPairSync('ed25519')
    const forged = signCheckpoint({ ...cp }, other.privateKey)
    expect(verifyOffsite({ accountId: ACC, objects, checkpoint: forged, publicKey: pub, server: head({}), now }).problems.join(' ')).toMatch(/BAD SIGNATURE/)
    const edited = objects.map((o) => ({ key: o.key, rows: o.rows.map((r) => (r.seq === '3' ? { ...r, action: 'lead.delete' } : r)) }))
    expect(verifyOffsite({ accountId: ACC, objects: edited, checkpoint: cp, publicKey: pub, server: head({}), now }).problems.join(' ')).toMatch(/breaks at seq 3 \(hash\)/)
  })

  it('detects a server that lost the chain entirely', () => {
    expect(verifyOffsite({ accountId: ACC, objects, checkpoint: cp, publicKey: pub, server: null, now }).ok).toBe(false)
  })
})
