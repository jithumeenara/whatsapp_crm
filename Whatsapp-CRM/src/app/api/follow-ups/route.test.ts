import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * ?due= and ?mine= on the follow-up list. The windows are cut on business
 * zone days; they must be the very ones the dashboard counts, so the list
 * a person opens has the number they clicked.
 */

const h = vi.hoisted(() => ({
  zone: 'Asia/Kolkata',
  wheres: [] as Array<Record<string, unknown>>,
  counts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRoleOrApiKey: async () => ({ accountId: 'acc', userId: 'me', role: 'agent' }) }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => h.zone }))
vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/leads/owned-refs', () => ({ checkOwnedRefs: async () => null }))
vi.mock('@/lib/db', () => ({
  prisma: {
    followUp: {
      findMany: async (a: { where: Record<string, unknown> }) => {
        h.wheres.push(a.where)
        return []
      },
      count: async (a: { where: Record<string, unknown> }) => {
        h.counts.push(a.where)
        return 0
      },
    },
  },
}))

import { GET } from './route'
import { followUpWindow, loadFollowUpBuckets } from '@/lib/leads/my-tasks'

const get = (qs: string) => GET(new NextRequest(`http://x/api/follow-ups?${qs}`))
const T = (iso: string) => new Date(iso)

describe('GET /api/follow-ups ?due=', () => {
  beforeEach(() => {
    h.wheres = []
    h.counts = []
    h.zone = 'Asia/Kolkata'
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('today ends at the start of tomorrow in Kolkata, to the millisecond', async () => {
    vi.setSystemTime(T('2026-11-07T18:29:59.999Z')) // 23:59:59.999 on the 7th
    await get('due=today')
    expect(h.wheres[0].due_at).toEqual({ gte: T('2026-11-07T18:29:59.999Z'), lt: T('2026-11-07T18:30:00.000Z') })
    h.wheres = []
    vi.setSystemTime(T('2026-11-07T18:30:00.000Z')) // 00:00 on the 8th
    await get('due=today')
    expect(h.wheres[0].due_at).toEqual({ gte: T('2026-11-07T18:30:00.000Z'), lt: T('2026-11-08T18:30:00.000Z') })
  })

  it('next7 is tomorrow to the start of the 8th day', async () => {
    vi.setSystemTime(T('2026-11-08T10:00:00.000Z'))
    await get('due=next7')
    expect(h.wheres[0].due_at).toEqual({ gte: T('2026-11-08T18:30:00.000Z'), lt: T('2026-11-15T18:30:00.000Z') })
  })

  it('follows the clock change in New York on 1 Nov 2026', async () => {
    h.zone = 'America/New_York'
    vi.setSystemTime(T('2026-11-01T12:00:00.000Z'))
    await get('due=today')
    // Midnight after the 1st is 05:00 UTC (EST), not 04:00 (EDT): a 25-hour day.
    expect(h.wheres[0].due_at).toEqual({ gte: T('2026-11-01T12:00:00.000Z'), lt: T('2026-11-02T05:00:00.000Z') })
  })

  it('a follow-up due exactly now is due today, not overdue', async () => {
    const now = T('2026-11-08T10:00:00.000Z')
    vi.setSystemTime(now)
    await get('due=overdue')
    expect(h.wheres[0].due_at).toEqual({ lt: now }) // due == now is excluded from overdue
    h.wheres = []
    await get('due=today')
    expect((h.wheres[0].due_at as { gte: Date }).gte).toEqual(now) // and included in today
  })

  it('uses the very window the dashboard counts', async () => {
    const now = T('2026-11-08T10:00:00.000Z')
    vi.setSystemTime(now)
    await loadFollowUpBuckets({ accountId: 'acc', userId: null, tz: 'Asia/Kolkata', now })
    const counted = h.counts.map((w) => w.due_at)
    for (const [i, kind] of (['overdue', 'today', 'next7'] as const).entries()) {
      h.wheres = []
      await get(`due=${kind}`)
      expect(h.wheres[0].due_at).toEqual(counted[i])
      expect(h.wheres[0].due_at).toEqual(followUpWindow(kind, now, 'Asia/Kolkata'))
    }
  })

  it('ignores a due value it does not know, and always scopes to the account', async () => {
    await get('due=lastyear')
    expect(h.wheres[0]).toEqual({ account_id: 'acc' })
  })
})

describe('GET /api/follow-ups ?mine=1', () => {
  beforeEach(() => {
    h.wheres = []
  })

  it('narrows to named-to-me, or unassigned and made by me, inside the account', async () => {
    await get('mine=1&due=today')
    expect(h.wheres[0].account_id).toBe('acc')
    expect(h.wheres[0].OR).toEqual([{ assigned_to: 'me' }, { assigned_to: null, user_id: 'me' }])
  })

  it('without it the list is the account-wide list it always was', async () => {
    await get('status=pending')
    expect(h.wheres[0]).toEqual({ account_id: 'acc', status: 'pending' })
  })
})
