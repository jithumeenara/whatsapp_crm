import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tasks: { overdue: 3, dueToday: 2, newLeads: 4 },
  missed: 5,
  missedCalled: 0,
  restricted: false,
}))

vi.mock('@/lib/leads/my-tasks', () => ({
  loadMyTasks: async () => ({
    overdue: { count: h.tasks.overdue, items: [] },
    dueToday: { count: h.tasks.dueToday, items: [] },
    newLeads: { count: h.tasks.newLeads, items: [] },
    pendingLeads: 0,
    pendingFollowUps: 0,
    todayTotal: 0,
  }),
}))
vi.mock('@/lib/dashboard/owner', () => ({
  missedCallsToday: async () => {
    h.missedCalled++
    return h.missed
  },
}))
vi.mock('@/lib/dashboard/scope', () => ({
  resolveDashboardScope: async (ctx: { userId: string; role: string }) =>
    h.restricted || ctx.role === 'agent'
      ? { view: 'agent', money: false, userId: ctx.userId }
      : { view: 'owner', money: true, userId: null },
}))

import { loadBell } from './bell'

const now = new Date('2026-11-08T10:00:00Z')

beforeEach(() => {
  h.tasks = { overdue: 3, dueToday: 2, newLeads: 4 }
  h.missed = 5
  h.missedCalled = 0
  h.restricted = false
})

describe('loadBell', () => {
  it('an owner sees their own tasks plus the missed calls of the day, with links', async () => {
    const b = await loadBell({ accountId: 'acc', userId: 'me', role: 'owner', pageAccess: null, tz: 'Asia/Kolkata', now })
    expect(b.items.map((i) => [i.key, i.count])).toEqual([
      ['overdue', 3], ['today', 2], ['new', 4], ['missed', 5],
    ])
    expect(b.total).toBe(14)
    expect(b.items.find((i) => i.key === 'overdue')!.href).toBe('/follow-ups?due=overdue&mine=1')
    expect(b.items.find((i) => i.key === 'new')!.href).toBe('/leads?tab=tasks&group=new')
    expect(b.items.find((i) => i.key === 'missed')!.href).toBe('/calls?status=missed&day=today')
  })

  it('an agent gets no missed-call count: a missed call has nobody on it', async () => {
    const b = await loadBell({ accountId: 'acc', userId: 'me', role: 'agent', pageAccess: null, tz: 'Asia/Kolkata', now })
    expect(b.items.map((i) => i.key)).toEqual(['overdue', 'today', 'new'])
    expect(h.missedCalled).toBe(0)
    expect(b.total).toBe(9)
  })

  it('leaves out what the person may not open', async () => {
    const b = await loadBell({ accountId: 'acc', userId: 'me', role: 'agent', pageAccess: ['/inbox', '/calls'], tz: 'Asia/Kolkata', now })
    expect(b.items).toEqual([])
    expect(b.total).toBe(0)
  })

  it('counts only items with something in them toward the badge, but lists all', async () => {
    h.tasks = { overdue: 0, dueToday: 0, newLeads: 1 }
    h.missed = 0
    const b = await loadBell({ accountId: 'acc', userId: 'me', role: 'admin', pageAccess: null, tz: 'Asia/Kolkata', now })
    expect(b.total).toBe(1)
    expect(b.items).toHaveLength(4)
  })
})
