import { describe, expect, it } from 'vitest'
import { recordDeviceSession } from './device-session'

/**
 * A new sign-in reused the browser's previous Sessions row and cleared
 * its revoked_at. Every token ever issued against that row — including a
 * copy stolen before the person pressed "Log out" on it, or before they
 * changed their password — became valid again the moment they signed back
 * in with the same browser (or any browser with an identical User-Agent,
 * which for a given Chrome version on Windows is most of them).
 *
 * A revoked row stays revoked. Only a live row is reused.
 */

type Row = { id: string; user_id: string; user_agent: string | null; revoked_at: Date | null; last_seen_at: Date; ip_address: string | null }

function fakeDb(rows: Row[]) {
  let n = 0
  return {
    rows,
    userSession: {
      findFirst: async ({ where }: { where: Partial<Row> }) =>
        rows
          .filter((r) => r.user_id === where.user_id && r.user_agent === where.user_agent)
          .filter((r) => !('revoked_at' in where) || r.revoked_at === where.revoked_at)
          .sort((a, b) => +b.last_seen_at - +a.last_seen_at)[0] ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      create: async ({ data }: { data: Partial<Row> }) => {
        const r = { id: `new-${++n}`, revoked_at: null, last_seen_at: new Date(), ip_address: null, user_agent: null, user_id: '', ...data } as Row
        rows.push(r)
        return r
      },
    },
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0'

describe('recording a sign-in against a device row', () => {
  it('never brings a revoked row back to life', async () => {
    const db = fakeDb([{ id: 'old', user_id: 'u1', user_agent: UA, revoked_at: new Date(), last_seen_at: new Date(), ip_address: null }])
    const id = await recordDeviceSession(db as never, 'u1', UA, '1.2.3.4')
    expect(id).not.toBe('old')
    expect(db.rows.find((r) => r.id === 'old')!.revoked_at).toBeInstanceOf(Date)
  })

  it('still reuses the live row for the same browser', async () => {
    const db = fakeDb([{ id: 'live', user_id: 'u1', user_agent: UA, revoked_at: null, last_seen_at: new Date(0), ip_address: null }])
    expect(await recordDeviceSession(db as never, 'u1', UA, '1.2.3.4')).toBe('live')
    expect(db.rows).toHaveLength(1)
  })
})
