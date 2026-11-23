import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Recording errors must never store a secret, never flood the database
 * and never break the code that logged them.
 */

const h = vi.hoisted(() => ({ sql: [] as Array<{ text: string; values: unknown[] }>, fail: false }))

vi.mock('@/lib/db', () => ({
  prisma: {
    $executeRaw: async (q: { strings: string[]; values: unknown[] }) => {
      if (h.fail) throw new Error('db down')
      h.sql.push({ text: q.strings.join('?'), values: q.values })
      return 1
    },
  },
}))

import { describeConsoleArgs, fingerprintOf, recordAppError, resetErrorCaptureForTests, safeLogArgs } from './record'

describe('safeLogArgs (what the pm2 log gets)', () => {
  it('redacts strings and error stacks, keeps objects, leads with the request id', () => {
    const err = new Error('GET /me?access_token=EAAB1234567890abcdefghijkl failed')
    const out = safeLogArgs(['[graph] failed for anu@example.com', err, { n: 1 }], 'ab12cd34')
    expect(out[0]).toBe('[rid:ab12cd34]')
    expect(String(out[1])).not.toContain('anu@example.com')
    expect((out[2] as Error).message).not.toContain('EAAB1234')
    expect((out[2] as Error).stack ?? '').not.toContain('EAAB1234')
    expect(out[3]).toEqual({ n: 1 })
  })
})

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => { h.sql = []; h.fail = false; resetErrorCaptureForTests() })

describe('recordAppError', () => {
  it('stores a redacted message with an upsert that counts repeats', async () => {
    recordAppError({ source: 'server', where: '[graph]', message: 'GET /me?access_token=EAAB1234567890abcdefghijkl failed for +919876543210' }, 1_000)
    await flush()
    expect(h.sql).toHaveLength(1)
    const stored = h.sql[0].values.map(String).join(' ')
    expect(stored).not.toMatch(/EAAB1234|9876543210/)
    expect(h.sql[0].text).toContain('ON CONFLICT (fingerprint)')
  })

  it('the same error within 30 s is counted, not written again', async () => {
    recordAppError({ source: 'server', where: '[x]', message: 'boom 1' }, 1_000)
    recordAppError({ source: 'server', where: '[x]', message: 'boom 2' }, 2_000)
    recordAppError({ source: 'server', where: '[x]', message: 'boom 3' }, 3_000)
    await flush()
    expect(h.sql).toHaveLength(1)
    recordAppError({ source: 'server', where: '[x]', message: 'boom 4' }, 40_000)
    await flush()
    expect(h.sql).toHaveLength(2)
    // the two repeats in between ride on the second write
    expect(h.sql[1].values).toContain(3)
  })

  it('a burst of different errors is capped per minute', async () => {
    for (let i = 0; i < 500; i++) recordAppError({ source: 'server', where: `[w${i}]`, message: `error kind ${'x'.repeat(i % 50)} ${i}` }, 5_000)
    await flush()
    expect(h.sql.length).toBeLessThanOrEqual(120)
  })

  it('a database that is down does not throw into the caller', async () => {
    h.fail = true
    expect(() => recordAppError({ source: 'server', where: '[x]', message: 'boom' })).not.toThrow()
    await flush()
  })
})

describe('describeConsoleArgs', () => {
  it('takes the log tag as the place and the error message with its first frame', () => {
    const err = new Error('connection reset')
    const d = describeConsoleArgs(['[auto-reply] handoff failed:', err])
    expect(d.where).toBe('[auto-reply]')
    expect(d.message).toContain('Error: connection reset')
  })

  it('different workspaces keep separate rows', () => {
    expect(fingerprintOf('browser', '/inbox', 'x', 'a')).not.toBe(fingerprintOf('browser', '/inbox', 'x', 'b'))
  })
})
