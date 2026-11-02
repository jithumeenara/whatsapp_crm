import { describe, expect, it } from 'vitest'
import { cleanText, diff, maskText, changedFieldNames } from './sanitize'
import { checkChain, genesisHash, rowHash, type ChainRow } from './hash'
import { prepare, PLATFORM_ACCOUNT } from './write'
import { AUDIT_ACTIONS, categoryOf } from './actions'

/**
 * The audit log keeps what happened without keeping what must never be
 * kept, and any change to a stored row — in any column — is detected.
 */

const ACC = '11111111-1111-4111-8111-111111111111'

describe('what never enters the log', () => {
  it('masks phone, Aadhaar, bank and card numbers and emails in free text', () => {
    const t = maskText('Call 9847012345, Aadhaar 1234 5678 9012, a/c 001234567890, card 4111-1111-1111-1111, mail anu.s@example.com, PAN ABCDE1234F')
    expect(t).not.toMatch(/9847012345|1234 5678 9012|001234567890|4111-1111-1111-1111|anu\.s@|ABCDE1234F/)
    expect(t).toContain('••••2345')
    expect(t).toContain('a•••@example.com')
  })

  it('keeps record ids whole, even when a run of their digits looks like a phone (bug)', () => {
    const id = '22222222-2222-4222-8222-222222222222'
    expect(maskText(`row ${id} by 9847012345`)).toBe(`row ${id} by ••••2345`)
    const r = prepare({ accountId: ACC, actor: { type: 'user' }, source: 'web' }, { action: 'record.updated', target: { type: 'lead', id }, meta: { verification_id: id, numeric_id: '123456789012' } })
    expect(r.target_id).toBe(id)
    expect((r.meta as Record<string, unknown>).verification_id).toBe(id)
    expect(prepare({ accountId: ACC, actor: { type: 'user' }, source: 'web' }, { action: 'record.updated', target: { type: 'data_record', id: '123456789012' } }).target_id).toBe('123456789012')
  })

  it('a broken (lone surrogate) name is stored as a valid character, so the hash matches what Postgres keeps', () => {
    expect(cleanText('Anu\uD800 S')).toBe('Anu� S')
  })

  it('masks a phone or ID number passed as a number, and does not treat "japan" as a PAN field', () => {
    expect(diff({ phone_n: 9847012345 }, { phone_n: 9847099999 })).toEqual({ phone_n: ['••••2345', '••••9999'] })
    expect(diff({ japan: 'x' }, { japan: 'y' })).toEqual({ japan: ['x', 'y'] })
  })

  it('stores account and on-behalf-of ids in lower case', () => {
    const r = prepare({ accountId: ACC.toUpperCase(), actor: { type: 'api_key', onBehalfOf: ACC.toUpperCase() }, source: 'api' }, { action: 'record.updated' })
    expect(r.account_id).toBe(ACC)
    expect(r.on_behalf_of).toBe(ACC)
  })

  it('keeps short numbers, amounts and dates', () => {
    expect(maskText('3 leads, ₹1,250 on 2026-11-02')).toBe('3 leads, ₹1,250 on 2026-11-02')
  })

  it('never keeps secret-looking fields, only that they changed', () => {
    const d = diff({ password: 'old', api_key: 'k1', access_token: 't1', name: 'A' }, { password: 'new', api_key: 'k2', access_token: 't2', name: 'B' })
    expect(JSON.stringify(d)).not.toMatch(/old|new|k1|k2|t1|t2/)
    expect(d?.password).toEqual(['[secret]', '[secret changed]'])
    expect(d?.name).toEqual(['A', 'B'])
  })

  it('keeps only the length of message bodies and long text fields', () => {
    const d = diff({ body: 'secret medical note' }, { body: 'another private note' })
    expect(d?.body).toEqual(['(19 chars)', '(20 chars)'])
  })

  it('strips line breaks and control characters (log injection)', () => {
    expect(cleanText('ok\r\nFAKE: admin logged in\u0000')).toBe('ok FAKE: admin logged in')
  })

  it('diffs only changed fields, and only fields that were part of the update', () => {
    expect(diff({ a: 1, b: 2, c: 3 }, { a: 1, b: 5 })).toEqual({ b: [2, 5] })
    expect(diff({ a: 1 }, { a: 1 })).toBeNull()
    expect(changedFieldNames({ token: 'x', url: 'a' }, { token: 'y', url: 'a' })).toEqual(['token'])
  })
})

describe('preparing an event', () => {
  it('refuses an unknown action instead of storing a typo', () => {
    expect(() => prepare({ accountId: ACC, actor: { type: 'user', id: 'u' }, source: 'web' }, { action: 'lead.updatd' as never })).toThrow(/Unknown audit action/)
  })

  it('puts events with no account on the platform chain', () => {
    const r = prepare({ accountId: null, actor: { type: 'system', id: 'proxy' }, source: 'system' }, { action: 'auth.rate_limited' })
    expect(r.account_id).toBe(PLATFORM_ACCOUNT)
    expect(r.category).toBe('auth')
  })

  it('keeps an IP address as given, but refuses anything that is not one', () => {
    const ok = prepare({ accountId: ACC, actor: { type: 'user' }, source: 'web', ip: '203.0.113.7' }, { action: 'auth.login_success' })
    const bad = prepare({ accountId: ACC, actor: { type: 'user' }, source: 'web', ip: '1.2.3.4\nX' }, { action: 'auth.login_success' })
    expect(ok.ip).toBe('203.0.113.7')
    expect(bad.ip).toBeNull()
  })

  it('every action has a category', () => {
    for (const a of AUDIT_ACTIONS) expect(categoryOf(a)).not.toBeNull()
  })
})

function chain(n: number): Array<ChainRow & { row_hash: string }> {
  const rows: Array<ChainRow & { row_hash: string }> = []
  let prev = genesisHash(ACC)
  for (let i = 1; i <= n; i++) {
    const r: ChainRow = {
      id: BigInt(100 + i), seq: BigInt(i), account_id: ACC,
      occurred_at: new Date(Date.UTC(2026, 10, 2, 10, 0, i)), ingested_at: new Date(Date.UTC(2026, 10, 2, 10, 0, i)),
      actor_type: 'user', actor_id: 'u1', actor_label: 'Anu', actor_role: 'admin', on_behalf_of: null,
      action: 'record.updated', category: 'data', outcome: 'success', reason: null,
      target_type: 'lead', target_id: `L${i}`, target_label: null, changes: { status: ['new', 'won'], n: i },
      request_id: `r${i}`, correlation_id: null, source: 'web', ip: '203.0.113.7', user_agent: 'UA', meta: null, prev_hash: prev,
    }
    const h = rowHash(r)
    rows.push({ ...r, row_hash: h })
    prev = h
  }
  return rows
}

describe('the hash chain', () => {
  it('an untouched chain verifies', () => {
    expect(checkChain(ACC, chain(5))).toMatchObject({ ok: true, lastSeq: BigInt(5) })
  })

  it('the hash does not depend on JSON key order', () => {
    const [r] = chain(1)
    expect(rowHash({ ...r, changes: { n: 1, status: ['new', 'won'] } })).toBe(r.row_hash)
  })

  it('an edit to any column is detected — including labels, IP and request id', () => {
    for (const edit of [{ actor_label: 'Someone' }, { ip: '198.51.100.1' }, { request_id: 'other' }, { reason: 'x' }, { changes: { status: ['new', 'lost'], n: 3 } }]) {
      const rows = chain(5)
      rows[2] = { ...rows[2], ...edit }
      expect(checkChain(ACC, rows)).toMatchObject({ ok: false, brokenAtSeq: '3', why: 'hash' })
    }
  })

  it('a deleted middle row is a gap', () => {
    const rows = chain(5)
    rows.splice(2, 1)
    expect(checkChain(ACC, rows)).toMatchObject({ ok: false, brokenAtSeq: '4', why: 'gap' })
  })

  it('a row re-hashed after editing still breaks the link to the next one', () => {
    const rows = chain(5)
    const edited = { ...rows[2], actor_label: 'Someone' }
    rows[2] = { ...edited, row_hash: rowHash(edited) }
    expect(checkChain(ACC, rows)).toMatchObject({ ok: false, brokenAtSeq: '4', why: 'link' })
  })

  it('a removed tail is not visible from the chain alone — that is what off-server checkpoints are for', () => {
    expect(checkChain(ACC, chain(5).slice(0, 3))).toMatchObject({ ok: true, lastSeq: BigInt(3) })
  })
})
