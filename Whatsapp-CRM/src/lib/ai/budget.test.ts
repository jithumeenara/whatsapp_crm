import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The monthly AI limit: spend is summed from the business's own 1st of
 * the month, the limit is "over" at 100%, admins hear at 80% and 100%
 * exactly once a month, and a failed read never silences the assistant.
 */

const h = vi.hoisted(() => ({
  budget: null as null | { monthly_limit_usd: number; warned_month: string | null; stopped_month: string | null },
  spent: 0,
  sumWhere: null as unknown,
  pushes: [] as Array<{ user: string; title: string }>,
  throwOnRead: false,
}))

vi.mock('./human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/push', () => ({
  sendPushToUser: async (user: string, p: { title: string }) => { h.pushes.push({ user, title: p.title }) },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    aiBudget: {
      findUnique: async () => { if (h.throwOnRead) throw new Error('relation "ai_budgets" does not exist'); return h.budget },
      updateMany: async ({ where, data }: { where: { OR: Array<Record<string, unknown>> }; data: Record<string, string> }) => {
        if (!h.budget) return { count: 0 }
        const field = 'stopped_month' in data ? 'stopped_month' : 'warned_month'
        const month = data[field]
        void where
        if (h.budget[field] === month) return { count: 0 }
        Object.assign(h.budget, data)
        return { count: 1 }
      },
    },
    aiUsageEvent: {
      aggregate: async ({ where }: { where: unknown }) => { h.sumWhere = where; return { _sum: { cost_usd: h.spent } } },
    },
    profile: { findMany: async () => [{ user_id: 'owner-1' }, { user_id: 'admin-2' }] },
  },
}))

import { aiBudgetState, budgetFrom, forgetBudget, monthWindow } from './budget'

const ACC = 'acc-1'
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  h.budget = null; h.spent = 0; h.sumWhere = null; h.pushes = []; h.throwOnRead = false
  forgetBudget(ACC)
})

describe('the month is the business’s own', () => {
  it('00:30 on 1 Dec in Kolkata is already December, and starts at 18:30 UTC on 30 Nov', () => {
    const at = new Date('2026-11-30T19:00:00Z') // 00:30 IST, 1 Dec
    const w = monthWindow(at, 'Asia/Kolkata')
    expect(w.month).toBe('2026-12')
    expect(w.startsAt.toISOString()).toBe('2026-11-30T18:30:00.000Z')
  })
})

describe('what a limit and a spend add up to', () => {
  it('no limit is never over', () => {
    expect(budgetFrom(null, 999, '2026-11')).toMatchObject({ limitUsd: null, over: false, ratio: 0 })
  })
  it('reaching the limit is over; just under is not', () => {
    expect(budgetFrom(10, 9.99, '2026-11').over).toBe(false)
    expect(budgetFrom(10, 10, '2026-11').over).toBe(true)
  })
})

describe('reading and telling', () => {
  it('no row: no limit, and the usage table is not even summed', async () => {
    const s = await aiBudgetState(ACC, new Date('2026-11-23T06:00:00Z'))
    expect(s.over).toBe(false)
    expect(h.sumWhere).toBeNull()
  })

  it('sums only this workspace from the start of its month', async () => {
    h.budget = { monthly_limit_usd: 20, warned_month: null, stopped_month: null }
    h.spent = 5
    await aiBudgetState(ACC, new Date('2026-11-23T06:00:00Z'))
    expect(h.sumWhere).toEqual({ account_id: ACC, created_at: { gte: new Date('2026-10-31T18:30:00.000Z') } })
  })

  it('at 80% the owners and admins are told once that month', async () => {
    h.budget = { monthly_limit_usd: 10, warned_month: null, stopped_month: null }
    h.spent = 8.5
    await aiBudgetState(ACC, new Date('2026-11-23T06:00:00Z'))
    await flush()
    expect(h.pushes.map((p) => p.title)).toEqual(['AI budget at 80%', 'AI budget at 80%'])
    forgetBudget(ACC)
    await aiBudgetState(ACC, new Date('2026-11-23T07:00:00Z'))
    await flush()
    expect(h.pushes).toHaveLength(2)
  })

  it('at the limit it is over and they are told it stopped, once', async () => {
    h.budget = { monthly_limit_usd: 10, warned_month: '2026-11', stopped_month: null }
    h.spent = 10.2
    const s = await aiBudgetState(ACC, new Date('2026-11-23T06:00:00Z'))
    await flush()
    expect(s.over).toBe(true)
    expect(h.pushes.map((p) => p.title)).toEqual(['AI budget used up', 'AI budget used up'])
    forgetBudget(ACC)
    await aiBudgetState(ACC, new Date('2026-11-23T08:00:00Z'))
    await flush()
    expect(h.pushes).toHaveLength(2)
  })

  it('a failed read (table not migrated yet) means no limit, never silence', async () => {
    h.throwOnRead = true
    const s = await aiBudgetState(ACC)
    expect(s.over).toBe(false)
  })
})
