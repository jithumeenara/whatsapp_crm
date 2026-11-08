import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  summaryCalls: [] as Array<{ accountId: string; userId: string | null }>,
  medianCalls: [] as Array<{ userId?: string | null; from: Date; to: Date }>,
  missed: 0,
  callWheres: [] as unknown[],
  taskCalls: 0,
}))

const SUMMARY = vi.hoisted(() => ({
  generatedAt: '2026-11-08T06:00:00.000Z',
  scope: 'team',
  cohort: { total: 40, won: 5, lost: 3, closedNoOutcome: 2, open: 30 },
  previousCohort: { total: 30, won: 4, lost: 2, closedNoOutcome: 1, open: 23 },
  excluded: 1,
  wonInPeriod: 6,
  lostInPeriod: 3,
  previousWonInPeriod: 4,
  calls: { total: 10, connected: 5, previousTotal: 8, countedSince: null },
  revenue: [{ currency: 'INR', amount: 5000, deals: 2, withAmount: 2 }],
  previousRevenue: [{ currency: 'INR', amount: 3000, deals: 1, withAmount: 1 }],
  lostAmount: [],
  pipeline: [{ currency: 'INR', amount: 90000, deals: 7, withAmount: 6 }],
  pipelineByStage: [],
  wonWithoutDate: 0,
  bySource: [{ source: 'Website', total: 20, won: 3, lost: 1, closedNoOutcome: 0, open: 16 }],
  byCategory: [],
  lostReasons: [],
  leaks: {
    neverContacted: { count: 4, rows: [] },
    overdueFollowUps: { count: 9, rows: [] },
    unassigned: { count: 3, rows: [] },
    waitingChats: { count: 2, rows: [{ id: 'c1', title: 'A', since: '2026-11-07T01:00:00.000Z', owner: null }, { id: 'c2', title: 'B', since: '2026-11-07T05:00:00.000Z', owner: null }] },
  },
  leakHours: 24,
  agents: [{ userId: 'u1', name: 'Asha', leads: 8, calls: 30, connected: 20, won: 4, lost: 1, overdueFollowUps: 2, daysWorked: 4, medianFirstReplyMinutes: 12 }],
  funnel: [{ key: 's1', label: 'Contacted', reached: 20 }],
}))

vi.mock('@/lib/db', () => ({
  prisma: { call: { count: async ({ where }: { where: unknown }) => { h.callWheres.push(where); return h.missed } } },
}))
vi.mock('@/lib/reports/summary', () => ({
  buildSummary: async (a: { accountId: string; userId: string | null }) => { h.summaryCalls.push(a); return SUMMARY },
  medianFirstReply: async (a: { userId?: string | null; from: Date; to: Date }) => { h.medianCalls.push(a); return a.from.getUTCFullYear() === 2026 && a.to.getUTCMonth() === 10 && a.to.getUTCDate() >= 8 ? 15 : 20 },
}))
vi.mock('@/lib/leads/my-tasks', () => ({
  loadMyTasks: async (a: { userId: string }) => { h.taskCalls++; return { overdue: { count: 1, items: [] }, dueToday: { count: 2, items: [] }, newLeads: { count: 3, items: [] }, pendingLeads: 4, pendingFollowUps: 5, todayTotal: 5, for: a.userId } },
  loadTeamTasks: async () => ({ overdue: 10, dueToday: 20, newLeads: 30, pendingLeads: 40, pendingFollowUps: 50 }),
  loadFollowUpBuckets: async (a: { userId: string | null }) => ({ overdue: a.userId ? 1 : 9, dueToday: a.userId ? 2 : 200, next7Days: a.userId ? 3 : 300 }),
}))

import { clearOwnerDashboardCache, getOwnerDashboard } from './owner'

const now = new Date('2026-11-08T06:00:00Z')
const base = { period: 'month' as const, now, tz: 'Asia/Kolkata' }
const ownerScope = { view: 'owner' as const, money: true, userId: null }
const teamScope = { view: 'team' as const, money: false, userId: null }
const agentScope = (id: string) => ({ view: 'agent' as const, money: false, userId: id })

beforeEach(() => {
  h.summaryCalls = []; h.medianCalls = []; h.callWheres = []; h.missed = 3; h.taskCalls = 0
  clearOwnerDashboardCache()
})

describe('owner dashboard: numbers pass through from the Reports engine', () => {
  it('cohort, won, funnel, source, team and leaks are the summary\'s own objects', async () => {
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    expect(d.kpis.cohort).toBe(SUMMARY.cohort)
    expect(d.kpis.previousCohort).toBe(SUMMARY.previousCohort)
    expect(d.kpis.wonInPeriod).toBe(SUMMARY.wonInPeriod)
    expect(d.kpis.previousWonInPeriod).toBe(SUMMARY.previousWonInPeriod)
    expect(d.kpis.revenue).toBe(SUMMARY.revenue)
    expect(d.kpis.previousRevenue).toBe(SUMMARY.previousRevenue)
    expect(d.kpis.pipeline).toBe(SUMMARY.pipeline)
    expect(d.funnel).toBe(SUMMARY.funnel)
    expect(d.bySource).toBe(SUMMARY.bySource)
    expect(d.team).toBe(SUMMARY.agents)
    expect(d.attention.overdueFollowUps).toBe(SUMMARY.leaks.overdueFollowUps.count)
    expect(d.attention.waitingChats).toBe(2)
    expect(d.attention.neverContacted).toBe(4)
    expect(d.attention.unassigned).toBe(3)
    expect(d.attention.leakHours).toBe(24)
    expect(d.attention.oldestWaitingChatSince).toBe('2026-11-07T01:00:00.000Z')
    expect(d.smallNumber).toBe(20)
  })

  it('describes the period in the business zone and who is looking', async () => {
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    expect(d.view).toBe('owner')
    expect(d.money).toBe(true)
    expect(d.period).toMatchObject({ kind: 'month', firstDay: '2026-11-01', lastDay: '2026-11-08', partial: true, timeZone: 'Asia/Kolkata' })
    expect(d.generatedAt).toBe(now.toISOString())
  })

  it('median first reply is asked for this period and for the one before', async () => {
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    expect(h.medianCalls).toHaveLength(2)
    expect(d.kpis.medianFirstReplyMinutes).toBe(15)
    expect(d.kpis.previousMedianFirstReplyMinutes).toBe(20)
  })
})

describe('owner dashboard: who sees what', () => {
  it('owner view: team, team tasks, whole-team follow-up buckets, own tasks', async () => {
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    expect(h.summaryCalls).toEqual([expect.objectContaining({ accountId: 'a1', userId: null })])
    expect(d.team).not.toBeNull()
    expect(d.teamTasks).toEqual({ overdue: 10, dueToday: 20, newLeads: 30, pendingLeads: 40, pendingFollowUps: 50 })
    expect(d.followUps).toEqual({ overdue: 9, dueToday: 200, next7Days: 300 })
    expect((d.tasks as unknown as { for: string }).for).toBe('v1')
  })

  it('supervisor view keeps counts but loses every money field', async () => {
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v2', scope: teamScope, ...base })
    expect(d.view).toBe('team')
    expect(d.money).toBe(false)
    expect(d.kpis.revenue).toBeNull()
    expect(d.kpis.previousRevenue).toBeNull()
    expect(d.kpis.pipeline).toBeNull()
    expect(d.team).toBe(SUMMARY.agents)
    expect(d.teamTasks).not.toBeNull()
    expect(JSON.stringify(d)).not.toContain('90000')
    expect(JSON.stringify(d)).not.toContain('5000')
  })

  it('agent view: scoped summary, no team, no team tasks, no money, no unassigned, no missed calls', async () => {
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v3', scope: agentScope('v3'), ...base })
    expect(h.summaryCalls[0]).toMatchObject({ accountId: 'a1', userId: 'v3' })
    expect(h.medianCalls.every((m) => m.userId === 'v3')).toBe(true)
    expect(d.view).toBe('agent')
    expect(d.team).toBeNull()
    expect(d.teamTasks).toBeNull()
    expect(d.kpis.revenue).toBeNull()
    expect(d.kpis.pipeline).toBeNull()
    expect(d.attention.unassigned).toBeNull()
    expect(d.attention.missedCallsToday).toBeNull()
    expect(d.followUps).toEqual({ overdue: 1, dueToday: 2, next7Days: 3 })
  })
})

describe('owner dashboard: one overdue number per screen', () => {
  it('agent view: the tile, the bucket and the Task group agree (a follow-up I made with no assignee counts in all three)', async () => {
    // Reports' leak count (assigned_to only) says 9; this person's own logic says 1.
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v3', scope: agentScope('v3'), ...base })
    expect(d.attention.overdueFollowUps).toBe(d.followUps.overdue)
    expect(d.attention.overdueFollowUps).toBe(d.tasks.overdue.count)
  })

  it('owner view: the tile and the bucket are both account-wide and agree', async () => {
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    expect(d.attention.overdueFollowUps).toBe(d.followUps.overdue)
  })
})

describe('owner dashboard: missed calls today', () => {
  it('counts missed calls from the start of today to the start of tomorrow in the business zone, in this account', async () => {
    h.missed = 7
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    expect(d.attention.missedCallsToday).toBe(7)
    expect(h.callWheres[0]).toEqual({
      account_id: 'a1', status: { in: ['missed', 'rejected'] },
      started_at: { gte: new Date('2026-11-07T18:30:00Z'), lt: new Date('2026-11-08T18:30:00Z') },
    })
  })
})

describe('owner dashboard cache', () => {
  it('serves a repeat within 30 seconds without asking the engine again', async () => {
    await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    expect(h.summaryCalls).toHaveLength(1)
  })

  it('never serves one person\'s data to another person of the same account and view', async () => {
    const a = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: agentScope('v1'), ...base })
    const b = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v2', scope: agentScope('v2'), ...base })
    expect(h.summaryCalls.map((c) => c.userId)).toEqual(['v1', 'v2'])
    expect((a.tasks as unknown as { for: string }).for).toBe('v1')
    expect((b.tasks as unknown as { for: string }).for).toBe('v2')
  })

  it('owner and a restricted agent view of the same person are separate entries', async () => {
    await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    const d = await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: agentScope('v1'), ...base })
    expect(h.summaryCalls).toHaveLength(2)
    expect(d.team).toBeNull()
  })

  it('never serves one account\'s data to another account', async () => {
    await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    await getOwnerDashboard({ accountId: 'a2', viewerId: 'v1', scope: ownerScope, ...base })
    expect(h.summaryCalls.map((c) => c.accountId)).toEqual(['a1', 'a2'])
  })

  it('keeps periods apart', async () => {
    await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
    await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base, period: 'week' })
    expect(h.summaryCalls).toHaveLength(2)
  })

  it('asks again after 30 seconds', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-08T06:00:00Z'))
      await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
      vi.setSystemTime(new Date('2026-11-08T06:00:31Z'))
      await getOwnerDashboard({ accountId: 'a1', viewerId: 'v1', scope: ownerScope, ...base })
      expect(h.summaryCalls).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })

  it('stays bounded', async () => {
    for (let i = 0; i < 400; i++) await getOwnerDashboard({ accountId: 'a1', viewerId: `v${i}`, scope: agentScope(`v${i}`), ...base })
    h.summaryCalls = []
    await getOwnerDashboard({ accountId: 'a1', viewerId: 'v0', scope: agentScope('v0'), ...base })
    expect(h.summaryCalls).toHaveLength(1) // the oldest entry was dropped
  })
})
