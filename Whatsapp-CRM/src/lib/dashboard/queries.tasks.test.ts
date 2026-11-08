import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Bug: Task.due_date is a calendar DATE, but "overdue" compared it with the
// server's clock instant. A task due today (stored as today's midnight UTC)
// therefore counted as overdue from 00:00 UTC, and on a UTC server the
// business's date could be a day off. It must compare with today's date in
// the business zone: due before today is overdue, due today is not.

type Where = { where: Record<string, Record<string, Date>> }

const h = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return { tasks: [] as Where[], followUps: [] as Where[] }
})

vi.mock('@/lib/db', () => {
  const rec = (store: Where[]) => async (args: Where) => {
    store.push(args)
    return 0
  }
  return {
    prisma: {
      companyProfile: { findUnique: async () => ({ timezone: 'Asia/Kolkata' }), findFirst: async () => ({ timezone: 'Asia/Kolkata' }) },
      lead: { groupBy: async () => [], count: async () => 0 },
      followUp: { count: rec(h.followUps) },
      task: { count: rec(h.tasks) },
      profile: { count: async () => 0 },
    },
  }
})

import { loadCRMStats } from './queries'

beforeEach(() => {
  h.tasks.length = 0
  h.followUps.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  // 20:00 UTC on 7 Nov is 01:30 on 8 Nov in Kolkata.
  vi.setSystemTime(new Date('2026-11-07T20:00:00Z'))
})
afterAll(() => vi.useRealTimers())

describe('loadCRMStats dates', () => {
  it('compares task due dates with today in the business zone (8 Nov), not the server instant', async () => {
    await loadCRMStats('acc-tasks', null)
    const [pending, overdue] = h.tasks.map((a) => a.where.due_date)
    expect(overdue.lt.toISOString()).toBe('2026-11-08T00:00:00.000Z')
    // Due today is still to do, not overdue.
    expect(pending.gte.toISOString()).toBe('2026-11-08T00:00:00.000Z')
  })

  it('keeps follow-up due times as instants (they carry a time)', async () => {
    await loadCRMStats('acc-tasks', null)
    const [pending, overdue] = h.followUps.map((a) => a.where.due_at)
    expect(pending.gte.toISOString()).toBe('2026-11-07T20:00:00.000Z')
    expect(overdue.lt.toISOString()).toBe('2026-11-07T20:00:00.000Z')
  })
})
