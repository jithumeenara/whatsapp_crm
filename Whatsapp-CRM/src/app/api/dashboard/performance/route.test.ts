import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Bug: the performance window began "days x 24h before now" on the server
// clock, so it started at a random hour of the day instead of the
// business's midnight (AGENTS.md rule 10).

const h = vi.hoisted(() => {
  process.env.TZ = 'UTC' // the VPS
  return { sinces: [] as Date[] }
})

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: 'acc', userId: 'me', role: 'supervisor' }) }
})
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/db', () => {
  const grab = (field: string) => async (args: { where: Record<string, { gte?: Date }> }) => {
    h.sinces.push(args.where[field].gte as Date)
    return []
  }
  return {
    prisma: {
      profile: { findMany: async () => [{ user_id: 'me', full_name: 'Me', account_role: 'supervisor' }] },
      lead: {
        groupBy: async (args: { where: Record<string, { gte?: Date }> }) => {
          const f = ['claimed_at', 'converted_at', 'lost_at'].find((k) => args.where[k])!
          return grab(f)(args)
        },
      },
      leadActivity: { findMany: grab('created_at') },
    },
  }
})

import { GET } from './route'

beforeEach(() => {
  h.sinces = []
  vi.useFakeTimers({ toFake: ['Date'] })
  // 20:00 UTC on 7 Nov is 01:30 on 8 Nov in Kolkata.
  vi.setSystemTime(new Date('2026-11-07T20:00:00Z'))
})
afterAll(() => vi.useRealTimers())

describe('GET /api/dashboard/performance window', () => {
  it('starts 7 days = the Kolkata midnight 6 days before today, not now minus 168 hours', async () => {
    const res = await GET(new NextRequest('http://x/api/dashboard/performance?days=7'))
    expect(res.status).toBe(200)
    // Today in Kolkata is 8 Nov; 7 days including today begin 2 Nov 00:00 IST.
    const expected = '2026-11-01T18:30:00.000Z'
    expect(h.sinces.length).toBeGreaterThan(0)
    for (const s of h.sinces) expect(s.toISOString()).toBe(expected)
    expect((await res.json()).since).toBe(expected)
  })
})
