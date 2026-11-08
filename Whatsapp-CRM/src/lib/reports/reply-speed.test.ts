import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { MIN_LEADS_FOR_RATE, replySpeed, speedFinding, speedRows } from './reply-speed'

const ACC = '11111111-1111-1111-1111-111111111111'
const AGENT = '22222222-2222-2222-2222-222222222222'
const FROM = new Date('2026-11-01T00:00:00Z')
const TO = new Date('2026-11-08T00:00:00Z')

/** A fake $queryRaw that records each query's SQL text and values. */
function fakeDb(answers: unknown[][]) {
  const seen: Array<{ text: string; values: unknown[] }> = []
  // Called as a tagged template, exactly like the real client: (strings, ...values).
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = Prisma.sql(strings, ...values)
    seen.push({ text: q.sql, values: q.values })
    return answers.shift() ?? []
  })
  return { db: { $queryRaw } as never, seen }
}

describe('speedRows', () => {
  it('fills every bucket in order and gives a percent only with enough leads', () => {
    const rows = speedRows([
      { bucket: 'min5', leads: BigInt(20), won: BigInt(5) },
      { bucket: 'later', leads: 3, won: 1 },
    ])
    expect(rows.map((r) => r.bucket)).toEqual(['min5', 'hour1', 'day1', 'later', 'none'])
    expect(rows[0]).toEqual({ bucket: 'min5', leads: 20, won: 5, winRate: 25 })
    expect(rows[3]).toEqual({ bucket: 'later', leads: 3, won: 1, winRate: null })
    expect(rows[1]).toEqual({ bucket: 'hour1', leads: 0, won: 0, winRate: null })
    expect(MIN_LEADS_FOR_RATE).toBe(10)
  })
})

describe('replySpeed', () => {
  it('an agent gets only the leads assigned to them', async () => {
    const { db, seen } = fakeDb([[{ since: new Date('2026-10-01T00:00:00Z') }], []])
    await replySpeed({ accountId: ACC, userId: AGENT, from: FROM, to: TO, db })
    expect(seen[1].text).toContain('l.assigned_to =')
    expect(seen[1].values).toContain(AGENT)
    expect(seen.every((q) => q.values.includes(ACC))).toBe(true)
  })

  it('the team view has no person filter', async () => {
    const { db, seen } = fakeDb([[{ since: new Date('2026-10-01T00:00:00Z') }], []])
    await replySpeed({ accountId: ACC, userId: null, from: FROM, to: TO, db })
    expect(seen[1].text).not.toContain('assigned_to')
  })

  it('never measured yet: no counting, and old leads are not called "never answered"', async () => {
    const { db, seen } = fakeDb([[{ since: null }]])
    const r = await replySpeed({ accountId: ACC, userId: null, from: FROM, to: TO, db })
    expect(r.countedSince).toBeNull()
    expect(r.rows.every((x) => x.leads === 0)).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it('counts only leads created after measuring began', async () => {
    const since = new Date('2026-11-04T10:00:00Z')
    const { db, seen } = fakeDb([[{ since }], [{ bucket: 'none', leads: 2, won: 0 }]])
    const r = await replySpeed({ accountId: ACC, userId: null, from: FROM, to: TO, db })
    expect(seen[1].values).toContainEqual(since)
    expect(seen[1].values).not.toContainEqual(FROM)
    expect(r.countedSince).toBe(since.toISOString())
    expect(r.rows.find((x) => x.bucket === 'none')?.leads).toBe(2)
  })

  it('measuring began after the period: nothing counted, one query', async () => {
    const { db, seen } = fakeDb([[{ since: new Date('2026-11-20T00:00:00Z') }]])
    const r = await replySpeed({ accountId: ACC, userId: null, from: FROM, to: TO, db })
    expect(r.rows.every((x) => x.leads === 0)).toBe(true)
    expect(seen).toHaveLength(1)
  })
})

describe('speedFinding', () => {
  const rows = (fast: [number, number], slow: [number, number]) => speedRows([
    { bucket: 'min5', leads: fast[0], won: fast[1] },
    { bucket: 'hour1', leads: slow[0], won: slow[1] },
  ])

  it('compares fast with all slower answers together', () => {
    expect(speedFinding(rows([20, 6], [40, 4]))).toBe('Leads answered within 5 minutes were won 30% of the time, against 10% when the first answer took longer.')
  })

  it('says nothing from too few leads on either side', () => {
    expect(speedFinding(rows([9, 9], [40, 4]))).toBeNull()
    expect(speedFinding(rows([20, 6], [5, 0]))).toBeNull()
  })

  it('says so when they are the same', () => {
    expect(speedFinding(rows([10, 2], [20, 4]))).toBe('Leads answered within 5 minutes were won as often as slower ones (20%).')
  })
})
