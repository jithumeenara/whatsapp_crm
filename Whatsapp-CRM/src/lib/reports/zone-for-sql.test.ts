import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { zoneForSql } from './summary'

/**
 * Bug (seen live): the business's zone was "Asia/Calcutta", which Node
 * accepts and that server's Postgres does not, so the whole report failed
 * with "time zone not recognized". A name Postgres does not know falls
 * back to the zone's offset instead.
 */

const flat = (sql: { strings: readonly string[]; values: unknown[] }) => ({ text: sql.strings.join('?'), values: sql.values })

describe('zoneForSql', () => {
  it('uses the name when this Postgres knows it', async () => {
    const db = { $queryRaw: vi.fn(async () => [{ ok: 1 }]) }
    expect(flat(await zoneForSql(db as never, 'Asia/Kolkata'))).toEqual({ text: '?', values: ['Asia/Kolkata'] })
  })

  it('falls back to the offset for a name Postgres does not know', async () => {
    const db = { $queryRaw: vi.fn(async () => []) }
    const sql = flat(await zoneForSql(db as never, 'Asia/Calcutta', new Date('2026-11-07T12:00:00Z')))
    expect(sql.text).toContain('make_interval')
    expect(sql.values).toEqual([330])
  })

  it('falls back to the offset when the lookup itself fails', async () => {
    const db = { $queryRaw: vi.fn(async () => { throw new Error('boom') }) }
    expect(flat(await zoneForSql(db as never, 'Asia/Kolkata', new Date('2026-11-07T12:00:00Z'))).values).toEqual([330])
  })
})
