import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ pageOk: true, rateOk: true, pages: [] as string[], calls: [] as Array<Record<string, unknown>>, fail: false }))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return {
    ...actual,
    requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'agent' }),
    assertPageAccess: (_c: unknown, page: string) => {
      h.pages.push(page)
      if (!h.pageOk) throw new actual.ForbiddenError('no')
    },
  }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: h.rateOk, limit: 60, remaining: 0, resetAt: Date.now() + 1000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'slow down' }), { status: 429 }),
}))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/leads/my-tasks', () => ({
  MAX_ITEMS: 50,
  MAX_ITEMS_ONE_GROUP: 200,
  loadMyTasks: async (a: Record<string, unknown>) => {
    if (h.fail) throw new Error('boom secret detail')
    h.calls.push(a)
    const item = (id: string) => ({ id, kind: 'follow_up', leadId: null, title: id, dueAt: null })
    return {
      overdue: { count: 5, items: [item('o')] }, dueToday: { count: 4, items: [item('d')] },
      newLeads: { count: 3, items: [item('n')] }, pendingLeads: 2, pendingFollowUps: 1, todayTotal: 7,
    }
  },
}))

import { GET } from './route'

const get = (qs = '') => GET(new NextRequest(`http://x/api/my-tasks${qs ? `?${qs}` : ''}`))

beforeEach(() => { h.pageOk = true; h.rateOk = true; h.pages = []; h.calls = []; h.fail = false })

describe('GET /api/my-tasks', () => {
  it('returns the caller\'s own tasks only, whatever the request names', async () => {
    const res = await get('userId=someone-else&user_id=x')
    expect(res.status).toBe(200)
    expect(h.calls[0]).toMatchObject({ accountId: 'acc', userId: 'me', tz: 'Asia/Kolkata', limit: 50 })
    const { tasks } = await res.json()
    expect(tasks.todayTotal).toBe(7)
    expect(h.pages).toEqual(['/leads'])
  })

  it('group=all keeps every list', async () => {
    const { tasks } = await (await get('group=all')).json()
    expect([tasks.overdue.items, tasks.dueToday.items, tasks.newLeads.items].map((i) => i.length)).toEqual([1, 1, 1])
  })

  it('group filters which lists carry items; counts are always there', async () => {
    const { tasks } = await (await get('group=overdue')).json()
    expect(tasks.overdue.items).toHaveLength(1)
    expect(tasks.dueToday.items).toEqual([])
    expect(tasks.newLeads.items).toEqual([])
    expect([tasks.overdue.count, tasks.dueToday.count, tasks.newLeads.count]).toEqual([5, 4, 3])
    const t2 = (await (await get('group=today')).json()).tasks
    expect([t2.overdue.items.length, t2.dueToday.items.length, t2.newLeads.items.length]).toEqual([0, 1, 0])
    const t3 = (await (await get('group=new')).json()).tasks
    expect([t3.overdue.items.length, t3.dueToday.items.length, t3.newLeads.items.length]).toEqual([0, 0, 1])
  })

  it('limit is passed on, kept between 1 and 50', async () => {
    await get('limit=12'); await get('limit=900'); await get('limit=abc')
    expect(h.calls.map((c) => c.limit)).toEqual([12, 50, 50])
  })

  it('a single group may ask for up to 200, group=all stays at 50', async () => {
    await get('group=overdue&limit=900'); await get('group=all&limit=900'); await get('group=today&limit=120')
    expect(h.calls.map((c) => [c.limit, c.cap])).toEqual([[200, 200], [50, 50], [120, 200]])
  })

  it('asks the loader for the one list only when a single group is requested', async () => {
    await get('group=today'); await get('group=all')
    expect(h.calls.map((c) => c.only)).toEqual(['today', undefined])
  })

  it('answers with the business time zone next to the tasks', async () => {
    expect((await (await get()).json()).timeZone).toBe('Asia/Kolkata')
  })

  it('an unknown group is a plain 400', async () => {
    const res = await get('group=everything')
    expect(res.status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('refuses without the Leads page, and when rate limited', async () => {
    h.pageOk = false
    expect((await get()).status).toBe(403)
    h.pageOk = true; h.rateOk = false
    expect((await get()).status).toBe(429)
    expect(h.calls).toHaveLength(0)
  })

  it('a failure says plain words', async () => {
    h.fail = true
    const res = await get()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('boom')
  })
})
