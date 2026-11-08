import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Task list definitions (product owner, 8 Nov 2026). A tiny in-memory
 * matcher runs the real `where` objects over fake rows, so these tests
 * prove who gets counted, not just what was asked of the database.
 */

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ followUps: [] as Row[], leads: [] as Row[], wheres: [] as Array<{ model: string; where: unknown }>, finds: [] as Array<{ model: string; where: unknown }> }))

function cmp(v: unknown, cond: unknown): boolean {
  if (cond === null) return v === null || v === undefined
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime()
  if (typeof cond === 'object') {
    const c = cond as Record<string, unknown>
    if ('mode' in c && 'equals' in c) return typeof v === 'string' && v.toLowerCase() === String(c.equals).toLowerCase()
    if ('equals' in c) return v === c.equals
    if ('not' in c) return !cmp(v, c.not)
    if ('in' in c) return (c.in as unknown[]).includes(v)
    if ('gte' in c && !(v instanceof Date && v.getTime() >= (c.gte as Date).getTime())) return false
    if ('gt' in c && !(v instanceof Date && v.getTime() > (c.gt as Date).getTime())) return false
    if ('lt' in c && !(v instanceof Date && v.getTime() < (c.lt as Date).getTime())) return false
    return true
  }
  return v === cond
}
function match(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Array<Record<string, unknown>>).some((w) => match(row, w))
    if (k === 'AND') return (cond as Array<Record<string, unknown>>).every((w) => match(row, w))
    return cmp(row[k], cond)
  })
}
const model = (name: string, rows: () => Row[]) => ({
  count: async ({ where }: { where: Record<string, unknown> }) => { h.wheres.push({ model: name, where }); return rows().filter((r) => match(r, where)).length },
  findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
    h.wheres.push({ model: name, where })
    h.finds.push({ model: name, where })
    return rows().filter((r) => match(r, where)).slice(0, take ?? 1000)
  },
})

vi.mock('@/lib/db', () => ({
  prisma: {
    followUp: { count: (a: never) => model('followUp', () => h.followUps).count(a), findMany: (a: never) => model('followUp', () => h.followUps).findMany(a) },
    lead: { count: (a: never) => model('lead', () => h.leads).count(a), findMany: (a: never) => model('lead', () => h.leads).findMany(a) },
  },
}))

import { followUpWindow, loadFollowUpBuckets, loadMyTasks, loadTeamTasks } from './my-tasks'

const ACC = 'acc'
const ME = 'me'
const OTHER = 'other'
const at = (iso: string) => new Date(iso)

const fu = (id: string, due: string, extra: Row = {}): Row => ({
  id, account_id: ACC, status: 'pending', title: `fu ${id}`, lead_id: `lead-${id}`, due_at: at(due), assigned_to: ME, user_id: ME, ...extra,
})
const lead = (id: string, extra: Row = {}): Row => ({
  id, account_id: ACC, status: 'new', title: `lead ${id}`, is_hidden: false, ai_suggested: false, assigned_to: ME, user_id: OTHER, source: 'whatsapp', created_at: at('2026-11-08T05:00:00Z'), ...extra,
})

beforeEach(() => { h.followUps = []; h.leads = []; h.wheres = []; h.finds = [] })

describe('follow-ups: overdue, today, later (Asia/Kolkata)', () => {
  // 8 Nov 2026, 23:59:59 IST = 18:29:59Z. Tomorrow starts 18:30:00Z.
  const now = at('2026-11-08T18:29:59Z')
  const tz = 'Asia/Kolkata'

  it('a follow-up due exactly now is due today, one second ago is overdue', async () => {
    h.followUps = [fu('exact', '2026-11-08T18:29:59Z'), fu('ago', '2026-11-08T18:29:58Z')]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.dueToday.items.map((i) => i.id)).toEqual(['exact'])
    expect(t.overdue.items.map((i) => i.id)).toEqual(['ago'])
  })

  it('23:59 business time is today, 00:00 business time is not (the next day)', async () => {
    h.followUps = [fu('late', '2026-11-08T18:29:59.999Z'), fu('mid', '2026-11-08T18:30:00Z')]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.dueToday.items.map((i) => i.id)).toEqual(['late'])
    expect(t.dueToday.count).toBe(1)
    const b = await loadFollowUpBuckets({ accountId: ACC, userId: ME, tz, now })
    expect(b).toEqual({ overdue: 0, dueToday: 1, next7Days: 1 })
  })

  it('next 7 days ends at the start of the 8th day after today', async () => {
    h.followUps = [
      fu('d7', '2026-11-15T18:29:59Z'), // 23:59 IST on 15 Nov: day 7 after today
      fu('d8', '2026-11-15T18:30:00Z'), // 00:00 IST on 16 Nov: outside
    ]
    const b = await loadFollowUpBuckets({ accountId: ACC, userId: ME, tz, now })
    expect(b.next7Days).toBe(1)
  })

  it('done, skipped and other accounts never count; counts stay true when items are cut', async () => {
    h.followUps = [
      fu('a', '2026-11-08T01:00:00Z'), fu('b', '2026-11-08T02:00:00Z'), fu('c', '2026-11-08T03:00:00Z'),
      fu('done', '2026-11-08T01:00:00Z', { status: 'done' }),
      fu('skip', '2026-11-08T01:00:00Z', { status: 'skipped' }),
      fu('foreign', '2026-11-08T01:00:00Z', { account_id: 'zzz' }),
    ]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now, limit: 2 })
    expect(t.overdue.count).toBe(3)
    expect(t.overdue.items).toHaveLength(2)
    expect(t.pendingFollowUps).toBe(3)
  })
})

describe('follow-ups across a daylight-saving change (America/New_York)', () => {
  // 1 Nov 2026 clocks go back. Today runs 04:00Z to 05:00Z next day (25 hours).
  const tz = 'America/New_York'
  const now = at('2026-11-01T12:00:00Z')
  it('today is 25 hours long and tomorrow starts at 05:00Z', async () => {
    h.followUps = [
      fu('late', '2026-11-02T04:59:59Z'), fu('tomorrow', '2026-11-02T05:00:00Z'),
      fu('d7', '2026-11-09T04:59:59Z'), fu('d8', '2026-11-09T05:00:00Z'),
    ]
    const b = await loadFollowUpBuckets({ accountId: ACC, userId: ME, tz, now })
    expect(b).toEqual({ overdue: 0, dueToday: 1, next7Days: 2 })
  })
})

describe('whose follow-up is mine', () => {
  const now = at('2026-11-08T06:00:00Z')
  const tz = 'Asia/Kolkata'
  it('assigned to me, or saved with no assignee by me; never somebody else\'s', async () => {
    h.followUps = [
      fu('assigned', '2026-11-07T01:00:00Z'),
      fu('mine-unassigned', '2026-11-07T01:00:00Z', { assigned_to: null, user_id: ME }),
      fu('theirs', '2026-11-07T01:00:00Z', { assigned_to: OTHER, user_id: ME }),
      fu('their-unassigned', '2026-11-07T01:00:00Z', { assigned_to: null, user_id: OTHER }),
    ]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.overdue.items.map((i) => i.id).sort()).toEqual(['assigned', 'mine-unassigned'])
  })
})

describe('leads: new and pending', () => {
  const now = at('2026-11-08T06:00:00Z')
  const tz = 'Asia/Kolkata'

  it('assigned to me, picked from the pool, or made by hand by me count as new', async () => {
    h.leads = [
      lead('assigned'),                                           // a manager gave it to me
      lead('manual-pool', { assigned_to: null, user_id: ME, source: 'manual' }), // I made it, nobody holds it
      lead('Manual-label', { assigned_to: null, user_id: ME, source: 'Manual' }),
    ]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.newLeads.count).toBe(3)
    expect(t.pendingLeads).toBe(3)
  })

  it('an owner does not get every automatic lead as "made by me"', async () => {
    // Automation saves user_id = the owner, with no assignee.
    h.leads = [
      lead('fb', { assigned_to: null, user_id: ME, source: 'facebook' }),
      lead('flow', { assigned_to: null, user_id: ME, source: 'whatsapp' }),
      lead('ai', { assigned_to: null, user_id: ME, source: 'ai_detect' }),
      lead('webhook', { assigned_to: null, user_id: ME, source: 'external' }),
      lead('admin-chat', { assigned_to: null, user_id: ME, source: 'admin_chat' }),
      lead('theirs-manual', { assigned_to: null, user_id: OTHER, source: 'manual' }),
      lead('given-away', { assigned_to: OTHER, user_id: ME, source: 'manual' }),
    ]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.newLeads.count).toBe(0)
    expect(t.pendingLeads).toBe(0)
  })

  it('hidden, AI-suggested and other accounts\' leads are left out', async () => {
    h.leads = [
      lead('ok'), lead('hid', { is_hidden: true }), lead('sug', { ai_suggested: true }), lead('foreign', { account_id: 'zzz' }),
    ]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.newLeads.items.map((i) => i.id)).toEqual(['ok'])
    expect(t.pendingLeads).toBe(1)
  })

  it('new and pending are separate: pending is open leads of any status but closed, and is not added to anything', async () => {
    h.leads = [lead('n1'), lead('n2'), lead('f1', { status: 'follow_up' }), lead('c1', { status: 'closed' })]
    h.followUps = [fu('x', '2026-11-08T08:00:00Z'), fu('y', '2026-11-20T08:00:00Z')]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.newLeads.count).toBe(2)
    expect(t.pendingLeads).toBe(3)
    expect(t.pendingFollowUps).toBe(2)
    expect(t.dueToday.count).toBe(1)
    expect(t.todayTotal).toBe(t.dueToday.count + t.newLeads.count)
    expect(t.todayTotal).toBe(3)
  })

  it('a lead task carries its id, title and status, and no due time', async () => {
    h.leads = [lead('n1')]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.newLeads.items[0]).toEqual({ id: 'n1', kind: 'lead', leadId: 'n1', title: 'lead n1', dueAt: null, status: 'new', source: 'whatsapp', createdAt: '2026-11-08T05:00:00.000Z' })
  })

  it('a follow-up item carries the due time as ISO and the lead it opens', async () => {
    h.followUps = [fu('x', '2026-11-08T08:00:00Z', { lead_id: null })]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(t.dueToday.items[0]).toEqual({ id: 'x', kind: 'follow_up', leadId: null, title: 'fu x', dueAt: '2026-11-08T08:00:00.000Z', leadTitle: null })
  })

  it('limit defaults to 8 and is capped at 50', async () => {
    h.followUps = Array.from({ length: 60 }, (_, i) => fu(`o${i}`, '2026-11-07T01:00:00Z'))
    const d = await loadMyTasks({ accountId: ACC, userId: ME, tz, now })
    expect(d.overdue.items).toHaveLength(8)
    expect(d.overdue.count).toBe(60)
    const m = await loadMyTasks({ accountId: ACC, userId: ME, tz, now, limit: 500 })
    expect(m.overdue.items).toHaveLength(50)
  })
})

describe('team tasks', () => {
  const now = at('2026-11-08T06:00:00Z')
  const tz = 'Asia/Kolkata'
  it('counts every pending follow-up in the account and only assigned leads', async () => {
    h.followUps = [
      fu('a', '2026-11-07T01:00:00Z'), fu('b', '2026-11-07T01:00:00Z', { assigned_to: OTHER }),
      fu('c', '2026-11-08T08:00:00Z', { assigned_to: null }), fu('d', '2026-11-20T08:00:00Z'),
      fu('z', '2026-11-07T01:00:00Z', { account_id: 'zzz' }), fu('done', '2026-11-07T01:00:00Z', { status: 'done' }),
    ]
    h.leads = [
      lead('n1'), lead('n2', { assigned_to: OTHER }), lead('pool', { assigned_to: null, user_id: ME, source: 'manual' }),
      lead('f1', { status: 'follow_up' }), lead('c1', { status: 'closed' }), lead('hid', { is_hidden: true }),
    ]
    const t = await loadTeamTasks({ accountId: ACC, tz, now })
    expect(t).toEqual({ overdue: 2, dueToday: 1, pendingFollowUps: 4, newLeads: 2, pendingLeads: 3 })
  })
})

describe('followUpWindow: the one definition of overdue / today / next 7 days', () => {
  const at2 = (iso: string) => new Date(iso)
  it('overdue is before now', () => {
    const now = at2('2026-11-08T06:00:00Z')
    expect(followUpWindow('overdue', now, 'Asia/Kolkata')).toEqual({ lt: now })
  })
  it('today runs from now to the start of tomorrow in the business zone', () => {
    const now = at2('2026-11-08T06:00:00Z')
    expect(followUpWindow('today', now, 'Asia/Kolkata')).toEqual({ gte: now, lt: at2('2026-11-08T18:30:00Z') })
  })
  it('next7 runs from the start of tomorrow to the start of the 8th day', () => {
    const now = at2('2026-11-08T06:00:00Z')
    expect(followUpWindow('next7', now, 'Asia/Kolkata')).toEqual({ gte: at2('2026-11-08T18:30:00Z'), lt: at2('2026-11-15T18:30:00Z') })
  })
  it('keeps the zone across a daylight-saving change (America/New_York, 1 Nov 2026)', () => {
    const now = at2('2026-11-01T12:00:00Z')
    expect(followUpWindow('today', now, 'America/New_York').lt).toEqual(at2('2026-11-02T05:00:00Z'))
    expect(followUpWindow('next7', now, 'America/New_York')).toEqual({ gte: at2('2026-11-02T05:00:00Z'), lt: at2('2026-11-09T05:00:00Z') })
  })
  it('windows never overlap and leave no gap at the edges', () => {
    const now = at2('2026-11-08T18:29:59Z'), tz = 'Asia/Kolkata'
    const o = followUpWindow('overdue', now, tz) as { lt: Date }
    const t = followUpWindow('today', now, tz) as { gte: Date; lt: Date }
    const n = followUpWindow('next7', now, tz) as { gte: Date; lt: Date }
    expect(o.lt).toEqual(t.gte)
    expect(t.lt).toEqual(n.gte)
  })
})

describe('loadMyTasks cap', () => {
  it('a single-group caller may ask for up to 200 items; the default cap stays 50', async () => {
    h.followUps = Array.from({ length: 260 }, (_, i) => fu(`o${i}`, '2026-11-07T01:00:00Z'))
    const now = at('2026-11-08T06:00:00Z')
    const wide = await loadMyTasks({ accountId: ACC, userId: ME, tz: 'Asia/Kolkata', now, limit: 900, cap: 200 })
    expect(wide.overdue.items).toHaveLength(200)
    const narrow = await loadMyTasks({ accountId: ACC, userId: ME, tz: 'Asia/Kolkata', now, limit: 900 })
    expect(narrow.overdue.items).toHaveLength(50)
  })
})

describe('loadMyTasks only one list', () => {
  it('fetches items for the asked list only; the other counts are still true', async () => {
    h.followUps = [fu('o1', '2026-11-07T01:00:00Z'), fu('t1', '2026-11-08T08:00:00Z')]
    h.leads = [lead('n1')]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz: 'Asia/Kolkata', now: at('2026-11-08T06:00:00Z'), only: 'overdue' })
    expect(h.finds).toHaveLength(1)
    expect(h.finds[0].model).toBe('followUp')
    expect(t.overdue.items.map((i) => i.id)).toEqual(['o1'])
    expect([t.dueToday.count, t.dueToday.items.length, t.newLeads.count, t.newLeads.items.length]).toEqual([1, 0, 1, 0])
    h.finds = []
    await loadMyTasks({ accountId: ACC, userId: ME, tz: 'Asia/Kolkata', now: at('2026-11-08T06:00:00Z'), only: 'new' })
    expect(h.finds.map((f) => f.model)).toEqual(['lead'])
  })
})

describe('known limitation: leads made through an API key', () => {
  it('a lead an integration creates with no source is stored as source "manual" by the key\'s person, so it looks hand-made', async () => {
    // POST /api/leads defaults source to 'manual' and writes the same
    // user_id and the same lead_activities row for a key as for a person.
    // Nothing stored on the lead tells them apart, so it counts as mine.
    // Fix in POST /api/leads: store source 'api' when ctx.apiKeyId is set
    // and no source was sent. Then this test should expect 0.
    h.leads = [lead('via-key', { assigned_to: null, user_id: ME, source: 'manual' })]
    const t = await loadMyTasks({ accountId: ACC, userId: ME, tz: 'Asia/Kolkata', now: at('2026-11-08T06:00:00Z') })
    expect(t.newLeads.count).toBe(1)
  })
})
