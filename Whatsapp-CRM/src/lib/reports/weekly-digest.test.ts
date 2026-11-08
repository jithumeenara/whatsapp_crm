import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportSummary } from './summary'

const h = vi.hoisted(() => ({
  profile: { account_id: 'acc', account_role: 'admin' } as { account_id: string; account_role: string } | null,
  builds: [] as Array<{ userId: string | null; from: string }>,
  fail: false,
}))

vi.mock('@/lib/db', () => ({
  prisma: { profile: { findUnique: async () => h.profile } },
}))

const leak = (count: number) => ({ count, rows: count ? [{ id: 'l1', title: 'Priya Nair +91 98470 12345', since: '2026-11-01T00:00:00Z', owner: 'Anu' }] : [] })

function summary(over: Partial<ReportSummary> = {}): ReportSummary {
  return {
    scope: 'team',
    cohort: { total: 160, won: 0, lost: 0, closedNoOutcome: 0, open: 0 },
    previousCohort: { total: 125, won: 0, lost: 0, closedNoOutcome: 0, open: 0 },
    wonInPeriod: 12, previousWonInPeriod: 12, lostInPeriod: 30,
    calls: { total: 300, connected: 180, previousTotal: 0, countedSince: null },
    revenue: [{ currency: 'INR', amount: 120000, deals: 4, withAmount: 4 }],
    leaks: { neverContacted: leak(10), overdueFollowUps: leak(3), unassigned: leak(0), waitingChats: leak(0) },
    leakHours: 24,
    ...over,
  } as ReportSummary
}

vi.mock('./summary', () => ({
  buildSummary: async (a: { userId: string | null; period: { firstDay: string } }) => {
    h.builds.push({ userId: a.userId, from: a.period.firstDay })
    if (h.fail) throw new Error('db down')
    return summary()
  },
}))

import { composeWeekly, isDigestDay, lastWeek, weeklyDigestFor } from './weekly-digest'

const MONDAY = '2026-11-09'
const args = { accountId: 'acc', userId: 'u1', localDate: MONDAY, timeZone: 'Asia/Kolkata', now: new Date('2026-11-09T03:30:00Z') }

beforeEach(() => {
  h.profile = { account_id: 'acc', account_role: 'admin' }
  h.builds = []
  h.fail = false
})

describe('week', () => {
  it('Monday is the day, and the week is the seven days before it', () => {
    expect(isDigestDay(MONDAY)).toBe(true)
    expect(isDigestDay('2026-11-08')).toBe(false)
    expect(lastWeek(MONDAY)).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(lastWeek('2026-03-02')).toEqual({ from: '2026-02-23', to: '2026-03-01' })
  })
})

describe('composeWeekly', () => {
  it('numbers, change on the week before, up to three things to do, and the link', () => {
    const text = composeWeekly(summary(), lastWeek(MONDAY), 'https://crm.example/reports')
    expect(text).toContain('*Last week* — 2 Nov to 8 Nov')
    expect(text).toContain('Leads: *160* (↑28% on the week before)')
    expect(text).toContain('Won: *12* (same as the week before) · Lost: *30*')
    expect(text).toContain('Revenue won: *₹1,20,000*')
    expect(text).toContain('1. Call the 10 leads nobody has contacted')
    expect(text).toContain('Full report: https://crm.example/reports')
  })

  it('never carries a customer name or number, only counts', () => {
    const text = composeWeekly(summary(), lastWeek(MONDAY), '')
    expect(text).not.toContain('Priya')
    expect(text).not.toContain('98470')
    expect(text).not.toContain('Anu')
  })

  it('says so when nothing leaks', () => {
    const none = summary({ leaks: { neverContacted: leak(0), overdueFollowUps: leak(0), unassigned: leak(0), waitingChats: leak(0) } })
    expect(composeWeekly(none, lastWeek(MONDAY), '')).toContain('Nothing is leaking right now.')
  })
})

describe('weeklyDigestFor', () => {
  it('an admin on Monday gets the team view of last week', async () => {
    const text = await weeklyDigestFor(args)
    expect(text).toContain('Last week')
    expect(h.builds).toEqual([{ userId: null, from: '2026-11-02' }])
  })

  it('someone no longer an admin, or in another account, gets nothing extra', async () => {
    h.profile = { account_id: 'acc', account_role: 'agent' }
    expect(await weeklyDigestFor(args)).toBeNull()
    h.profile = { account_id: 'other', account_role: 'owner' }
    expect(await weeklyDigestFor(args)).toBeNull()
    h.profile = null
    expect(await weeklyDigestFor(args)).toBeNull()
    expect(h.builds).toHaveLength(0)
  })

  it('not Monday: nothing, and no report is built', async () => {
    expect(await weeklyDigestFor({ ...args, localDate: '2026-11-10' })).toBeNull()
    expect(h.builds).toHaveLength(0)
  })

  it('builds once per account for several admins', async () => {
    const cache = new Map<string, string | null>()
    await weeklyDigestFor({ ...args, cache })
    await weeklyDigestFor({ ...args, userId: 'u2', cache })
    expect(h.builds).toHaveLength(1)
  })

  it('a failed report gives null so the plain brief still goes', async () => {
    h.fail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await weeklyDigestFor(args)).toBeNull()
  })
})
