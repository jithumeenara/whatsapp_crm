import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug (live on ACSTI, 2026-11-28): "Retry" on Sheet routing failed with
 * "Unique constraint failed on the fields: (record_id)". A row that failed
 * more than once has several failed jobs; turning them all back to
 * 'pending' at once breaks the one-pending-job-per-row index
 * (sheet_jobs_record_pending_uq), so nothing was retried at all.
 *
 * This simulates that index: retrying must leave at most one pending job
 * per record, and must not throw.
 */

type Job = { id: string; record_id: string; kind: string; status: string; created_at: number; table_id: string; account_id: string }
const h = vi.hoisted(() => ({ jobs: [] as Job[] }))

function assertUniquePending(jobs: Job[]) {
  const seen = new Set<string>()
  for (const j of jobs) {
    if (j.kind !== 'record' || j.status !== 'pending') continue
    if (seen.has(j.record_id)) throw new Error('Unique constraint failed on the fields: (`record_id`)')
    seen.add(j.record_id)
  }
}

vi.mock('@/lib/db', () => {
  // Called as a tagged template ($executeRaw`…`) or with a Prisma.sql object.
  const run = (q: readonly string[] | { strings: readonly string[] }) => {
    const sql = (Array.isArray(q) ? q : (q as { strings: readonly string[] }).strings).join('?')
    if (/DELETE FROM sheet_jobs/.test(sql)) {
      const before = h.jobs.length
      // Failed jobs whose record already has a pending one.
      if (/EXISTS \(SELECT 1 FROM sheet_jobs p WHERE p.record_id = f.record_id AND p.kind = 'record' AND p.status = 'pending'\)/.test(sql)) {
        h.jobs = h.jobs.filter((f) => !(f.status === 'failed' && h.jobs.some((p) => p.record_id === f.record_id && p.status === 'pending')))
      }
      // Older duplicate failed jobs for the same record.
      if (/USING sheet_jobs g/.test(sql)) {
        h.jobs = h.jobs.filter((f) => !(f.status === 'failed' && h.jobs.some((g) => g !== f && g.status === 'failed' && g.record_id === f.record_id && (g.created_at > f.created_at || (g.created_at === f.created_at && g.id > f.id)))))
      }
      return Promise.resolve(before - h.jobs.length)
    }
    return Promise.resolve(0)
  }
  const prisma = {
    $executeRaw: run,
    sheetJob: {
      updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        const next = h.jobs.map((j) => (j.status === where.status ? { ...j, status: data.status } : j))
        assertUniquePending(next)
        h.jobs = next
        return { count: next.filter((j, i) => h.jobs[i] && j.status === data.status).length }
      },
    },
    $transaction: async (fn: unknown) => (typeof fn === 'function' ? (fn as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(fn as Promise<unknown>[])),
  }
  return { prisma }
})

import { retryFailed } from './sheet-routing'

const job = (id: string, record: string, status: string, at: number): Job => ({ id, record_id: record, kind: 'record', status, created_at: at, table_id: 't1', account_id: 'a1' })

beforeEach(() => { vi.useFakeTimers() })

describe('retrying failed sheet jobs', () => {
  it('a row that failed twice is retried once, without breaking the unique index', async () => {
    h.jobs = [job('j1', 'r1', 'failed', 1), job('j2', 'r1', 'failed', 2), job('j3', 'r2', 'failed', 3)]
    await expect(retryFailed('t1', 'a1')).resolves.toBeTypeOf('number')
    const pending = h.jobs.filter((j) => j.status === 'pending')
    expect(pending.map((j) => j.record_id).sort()).toEqual(['r1', 'r2'])
    // the newest failed job of r1 is the one kept
    expect(pending.find((j) => j.record_id === 'r1')?.id).toBe('j2')
  })
})
