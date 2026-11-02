import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

/**
 * Fallback replay must be idempotent per account and lose nothing:
 * renamed before reading, written back after each account commits,
 * quarantined after three failures, and events written during a replay
 * land in a fresh file.
 */

const h = vi.hoisted(() => ({
  append: vi.fn<(rows: Array<Record<string, unknown>>, replay?: unknown) => Promise<void>>(),
  audit: vi.fn<(ctx: unknown, e: unknown) => Promise<void>>(),
}))
vi.mock('./write', () => ({ appendPrepared: h.append, audit: h.audit }))

import { keepForReplay, replayAuditFallback, MAX_REPLAY_TRIES } from './fallback'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

let dir: string
const live = () => path.join(dir, 'audit-fallback.ndjson')
const processing = () => path.join(dir, 'audit-fallback.processing')
const quarantine = () => path.join(dir, 'audit-fallback.quarantine')
const exists = (p: string) => fs.stat(p).then(() => true, () => false)
const lines = async (p: string) => (await fs.readFile(p, 'utf8').catch(() => '')).split('\n').filter(Boolean)

const row = (account: string, n: number) => ({ account_id: account, action: 'record.updated', meta: { n }, occurred_at: new Date('2026-11-01T10:00:00Z') })
const keep = (rows: Array<ReturnType<typeof row>>) => keepForReplay(rows, { dir })
const accountsOf = (call: unknown[]) => [...new Set((call[0] as Array<{ account_id: string }>).map((r) => r.account_id))]

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-fallback-'))
  h.append.mockReset().mockResolvedValue(undefined)
  h.audit.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('audit fallback replay', () => {
  it('replays every line once, one account per call, marked as replayed, and removes the file', async () => {
    await keep([row(A, 1), row(B, 2), row(A, 3)])
    const r = await replayAuditFallback({ dir })
    expect(r).toEqual(expect.objectContaining({ replayed: 3, refused: 0, quarantined: 0, pending: 0 }))
    expect(h.append).toHaveBeenCalledTimes(2)
    expect(h.append.mock.calls.map(accountsOf)).toEqual([[A], [B]])
    const first = h.append.mock.calls[0][0]
    expect(first.map((x) => (x.meta as { n: number }).n)).toEqual([1, 3])
    expect(first[0].meta).toEqual(expect.objectContaining({ replayed: true }))
    expect(first[0].occurred_at).toBeInstanceOf(Date)
    expect(await exists(live())).toBe(false)
    expect(await exists(processing())).toBe(false)
  })

  it('keeps events written during the replay in a fresh file', async () => {
    await keep([row(A, 1)])
    h.append.mockImplementationOnce(async () => {
      // The database is still flaky: a new event fails and is kept meanwhile.
      await keep([row(B, 99)])
    })
    h.append.mockImplementationOnce(async () => { throw new Error('still down') })
    await replayAuditFallback({ dir })
    // The new event was not swallowed by the replay that was running: it
    // went to a fresh file, was tried on its own afterwards, and waits.
    const seen = h.append.mock.calls.map((c) => c[0].map((x) => (x.meta as { n: number }).n))
    expect(seen).toEqual([[1], [99]])
    const left = await lines(processing())
    expect(left).toHaveLength(1)
    expect(JSON.parse(JSON.parse(left[0]).body).meta.n).toBe(99)
  })

  it('never repeats an account that committed when a later account fails', async () => {
    await keep([row(A, 1), row(B, 2)])
    h.append.mockImplementation(async (rows) => {
      if (rows[0].account_id === B) {
        // A has committed: it must already be gone from the .processing file.
        const left = await lines(processing())
        expect(left.map((l) => JSON.parse(JSON.parse(l).body).account_id)).toEqual([B])
        throw new Error('database down')
      }
    })
    const r1 = await replayAuditFallback({ dir })
    expect(r1).toEqual(expect.objectContaining({ replayed: 1, pending: 1, quarantined: 0 }))
    const left = await lines(processing())
    expect(left).toHaveLength(1)
    expect(JSON.parse(left[0]).tries).toBe(1)

    h.append.mockReset().mockResolvedValue(undefined)
    const r2 = await replayAuditFallback({ dir })
    expect(r2.replayed).toBe(1)
    expect(h.append.mock.calls.map(accountsOf)).toEqual([[B]])
    expect(await exists(processing())).toBe(false)
  })

  it(`moves a line that failed ${MAX_REPLAY_TRIES} times to the quarantine file (0600) and reports it`, async () => {
    await keep([row(A, 1)])
    h.append.mockRejectedValue(new Error('constraint'))
    for (let i = 1; i < MAX_REPLAY_TRIES; i++) {
      const r = await replayAuditFallback({ dir })
      expect(r).toEqual(expect.objectContaining({ pending: 1, quarantined: 0 }))
    }
    const r = await replayAuditFallback({ dir })
    expect(r).toEqual(expect.objectContaining({ pending: 0, quarantined: 1 }))
    expect(await exists(processing())).toBe(false)
    const q = await lines(quarantine())
    expect(q).toHaveLength(1)
    expect(JSON.parse(q[0]).why).toMatch(/3 times/)
    if (process.platform !== 'win32') expect((await fs.stat(quarantine())).mode & 0o777).toBe(0o600)
    const report = h.audit.mock.calls.at(-1)?.[1] as { action: string; outcome: string; meta: Record<string, number> }
    expect(report).toEqual(expect.objectContaining({ action: 'system.audit_write_failed', outcome: 'failure' }))
    expect(report.meta.quarantined).toBe(1)
  })

  it('refuses a line whose signature does not match and keeps it in quarantine', async () => {
    await keep([row(A, 1)])
    const forged = JSON.stringify({ body: JSON.stringify({ ...row(A, 2), occurred_at: '2026-11-01T10:00:00.000Z' }), mac: 'a'.repeat(64) })
    await fs.appendFile(live(), forged + '\n')
    const r = await replayAuditFallback({ dir })
    expect(r).toEqual(expect.objectContaining({ replayed: 1, refused: 1 }))
    expect(h.append.mock.calls[0][0].map((x) => (x.meta as { n: number }).n)).toEqual([1])
    const q = await lines(quarantine())
    expect(JSON.parse(q[0])).toEqual(expect.objectContaining({ why: 'signature does not match', line: forged }))
  })

  it('finishes a .processing file left by a crash before the current file', async () => {
    await keep([row(A, 1)])
    await fs.rename(live(), processing())
    await keep([row(A, 2)])
    const r = await replayAuditFallback({ dir })
    expect(r.replayed).toBe(2)
    expect(h.append.mock.calls.map((c) => c[0].map((x) => (x.meta as { n: number }).n))).toEqual([[1], [2]])
    expect(await exists(processing())).toBe(false)
    expect(await exists(live())).toBe(false)
  })

  it('does nothing (and records nothing) when there is no file', async () => {
    const r = await replayAuditFallback({ dir })
    expect(r).toEqual({ replayed: 0, refused: 0, quarantined: 0, pending: 0, dropped: 0 })
    expect(h.append).not.toHaveBeenCalled()
    expect(h.audit).not.toHaveBeenCalled()
  })
})
