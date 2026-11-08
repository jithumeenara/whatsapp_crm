import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { medianFirstReply } from './summary'

const from = new Date('2026-11-01T00:00:00Z')
const to = new Date('2026-11-08T00:00:00Z')

function fakeDb(rows: Array<{ median: number | null }>) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  // Prisma.sql values nest: flatten them into one text and one value list.
  type Nested = { strings: string[]; values: unknown[] }
  const isSql = (v: unknown): v is Nested => !!v && typeof v === 'object' && Array.isArray((v as Nested).strings)
  const flat = (strings: ReadonlyArray<string>, values: unknown[]): { sql: string; values: unknown[] } => {
    let sql = ''
    const out: unknown[] = []
    strings.forEach((str, i) => {
      sql += str
      if (i >= values.length) return
      const v = values[i]
      if (isSql(v)) {
        const inner = flat(v.strings, v.values)
        sql += inner.sql
        out.push(...inner.values)
      } else {
        sql += '?'
        out.push(v)
      }
    })
    return { sql, values: out }
  }
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(flat(strings, values))
    return rows
  }
  return { db: { $queryRaw } as never, calls }
}

describe('medianFirstReply', () => {
  it('rounds the median minutes, or says null when nobody was answered', async () => {
    expect(await medianFirstReply({ accountId: 'a', from, to, db: fakeDb([{ median: 12.6 }]).db })).toBe(13)
    expect(await medianFirstReply({ accountId: 'a', from, to, db: fakeDb([{ median: null }]).db })).toBeNull()
    expect(await medianFirstReply({ accountId: 'a', from, to, db: fakeDb([]).db })).toBeNull()
  })

  it('uses the same rule as the per-person median: first reply inside the period, minus created_at', async () => {
    const { db, calls } = fakeDb([{ median: 5 }])
    await medianFirstReply({ accountId: 'acc-1', from, to, db })
    const sql = calls[0].sql
    expect(sql).toContain('percentile_cont(0.5)')
    expect(sql).toContain('l.first_response_at - l.created_at')
    expect(sql).toContain('l.first_response_at >=')
    expect(sql).toContain('l.first_response_at <')
    expect(sql).toContain('l.account_id')
    expect(sql).toContain('l.first_response_by IS NOT NULL')
    expect(calls[0].values).toEqual(expect.arrayContaining(['acc-1', from, to]))
  })

  it('narrows to one person when asked', async () => {
    const { db, calls } = fakeDb([{ median: 5 }])
    await medianFirstReply({ accountId: 'acc-1', userId: 'u-9', from, to, db })
    expect(calls[0].sql).toContain('l.first_response_by')
    expect(calls[0].values).toContain('u-9')
  })
})
