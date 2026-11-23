import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Fixes from the 2026-11-23 security audit:
 *  - browser error reports have their own per-minute share;
 *  - old errors are pruned, always with a WHERE;
 *  - every automatic customer-AI path checks the monthly budget;
 *  - a live exchange rate far from the saved one is not trusted.
 */

const h = vi.hoisted(() => ({ writes: 0, deleteWhere: null as unknown }))
vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: async () => { h.writes += 1; return 1 },
    appError: { deleteMany: async ({ where }: { where: unknown }) => { h.deleteWhere = where; return { count: 0 } } },
  },
}))
vi.mock('@/lib/ai/fx-live', () => ({ liveUsdRate: async () => ({ rate: 880, fetchedAt: new Date() }) }))

import { recordAppError, resetErrorCaptureForTests } from './record'
import { pruneOldErrors } from './alert-sweep'
import { effectiveRate } from '@/lib/ai/budget'

const flush = () => new Promise((r) => setTimeout(r, 0))
beforeEach(() => { h.writes = 0; h.deleteWhere = null; resetErrorCaptureForTests() })

describe('browser reports cannot crowd out server errors', () => {
  it('at most 30 browser writes a minute, server errors still recorded after', async () => {
    for (let i = 0; i < 100; i++) recordAppError({ source: 'browser', where: `/p${i}`, message: `err ${i}` }, 1_000)
    await flush()
    expect(h.writes).toBe(30)
    recordAppError({ source: 'server', where: '[db]', message: 'real server error' }, 1_000)
    await flush()
    expect(h.writes).toBe(31)
  })
})

describe('pruning old errors', () => {
  it('deletes only resolved > 30 days or unseen > 90 days', async () => {
    const now = new Date('2026-11-23T00:00:00Z')
    await pruneOldErrors(now)
    expect(h.deleteWhere).toEqual({
      OR: [
        { resolved_at: { lt: new Date('2026-10-24T00:00:00Z') } },
        { last_seen: { lt: new Date('2026-08-25T00:00:00Z') } },
      ],
    })
  })
})

describe('the budget covers every automatic AI reply', () => {
  it('auto-reply and the chatbot AI node both check it', () => {
    const root = process.cwd()
    for (const f of ['src/lib/ai/auto-reply.ts', 'src/lib/flows/engine.ts']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8')).toContain('aiBudgetState(')
    }
  })
})

describe('live rate sanity', () => {
  it('a live rate 10x the saved one is ignored; the saved rate is used', async () => {
    expect(await effectiveRate('INR', 88, true)).toEqual({ rate: 88, fetchedAt: null })
  })
})
