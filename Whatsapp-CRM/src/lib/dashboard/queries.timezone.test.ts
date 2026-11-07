import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Bug: the dashboard's "today", "yesterday" and per-day buckets were cut
// on the SERVER clock. One customer VPS runs on UTC while the business is
// in India, so "today" began at 05:30 IST and a message sent at 00:30 IST
// landed on the previous day. Day boundaries must follow the business's
// own time zone (AGENTS.md rule 10), whatever the server clock says.

const h = vi.hoisted(() => {
  const originalTz = process.env.TZ
  process.env.TZ = 'UTC' // the VPS
  return {
    originalTz,
    calls: [] as Array<{ model: string; method: string; args: any }>,
    rows: {} as Record<string, unknown[]>,
  }
})

vi.mock('@/lib/db', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args?: any) => {
          h.calls.push({ model: name, method, args })
          if (name === 'companyProfile') return Promise.resolve({ timezone: 'Asia/Kolkata' })
          if (method === 'count') return Promise.resolve(0)
          if (method === 'findMany') return Promise.resolve(h.rows[name] ?? [])
          return Promise.resolve([])
        },
      },
    )
  return { prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }
})

import { loadConversationsSeries, loadMetrics, loadResponseTime, loadSparks } from './queries'

const ACCOUNT = 'acc-tz'

// 20:00 UTC on 7 Nov is 01:30 on 8 Nov in Kolkata.
const NOW = new Date('2026-11-07T20:00:00Z')
const KOLKATA_TODAY = '2026-11-07T18:30:00.000Z'
const KOLKATA_YESTERDAY = '2026-11-06T18:30:00.000Z'

beforeEach(() => {
  h.calls.length = 0
  h.rows = {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterAll(() => {
  vi.useRealTimers()
  if (h.originalTz === undefined) delete process.env.TZ
  else process.env.TZ = h.originalTz
})

function createdAt(model: string): Array<{ gte?: Date; lt?: Date }> {
  return h.calls
    .filter((c) => c.model === model && c.args?.where?.created_at)
    .map((c) => c.args.where.created_at)
}

describe('dashboard days follow the business time zone, not the server clock', () => {
  it("starts today at midnight in Kolkata (18:30 UTC the day before)", async () => {
    await loadMetrics(ACCOUNT, null)
    const windows = createdAt('contact')
    expect(windows).toHaveLength(2)
    const [today, yesterday] = windows
    expect(today.gte?.toISOString()).toBe(KOLKATA_TODAY)
    expect(yesterday.gte?.toISOString()).toBe(KOLKATA_YESTERDAY)
    expect(yesterday.lt?.toISOString()).toBe(KOLKATA_TODAY)
  })

  it('puts a message sent at 00:30 IST on that Kolkata day in the chart', async () => {
    h.rows.message = [
      { created_at: new Date('2026-11-07T19:00:00Z'), sender_type: 'customer', conversation_id: 'c1' },
    ]
    const series = await loadConversationsSeries(ACCOUNT, 7, null)
    expect(series.at(-1)?.day).toBe('2026-11-08')
    expect(series.at(-1)?.incoming).toBe(1)
    expect(createdAt('message')[0].gte?.toISOString()).toBe('2026-11-01T18:30:00.000Z')
  })

  it('buckets the sparklines by Kolkata day', async () => {
    h.rows.message = [
      { created_at: new Date('2026-11-07T19:00:00Z'), sender_type: 'agent', conversation_id: 'c1' },
    ]
    const sparks = await loadSparks(ACCOUNT, 7, null)
    expect(sparks.days.at(-1)).toBe('2026-11-08')
    expect(sparks.messagesSent.at(-1)).toBe(1)
  })

  it('counts the response-time window and day of week in Kolkata', async () => {
    // Sunday 8 Nov 00:30 IST (Saturday 19:00 UTC), answered ten minutes later.
    h.rows.message = [
      { conversation_id: 'c1', sender_type: 'customer', created_at: new Date('2026-11-07T19:00:00Z') },
      { conversation_id: 'c1', sender_type: 'agent', created_at: new Date('2026-11-07T19:10:00Z') },
    ]
    const rt = await loadResponseTime(ACCOUNT, null)
    expect(createdAt('message')[0].gte?.toISOString()).toBe('2026-10-25T18:30:00.000Z')
    expect(rt.buckets[6].samples).toBe(1) // Sunday
    expect(rt.buckets[5].samples).toBe(0) // not Saturday
    expect(rt.thisWeekAvg).toBe(10) // Mon 2 Nov – Sun 8 Nov in Kolkata
  })
})
