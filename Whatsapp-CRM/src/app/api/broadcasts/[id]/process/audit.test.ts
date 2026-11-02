import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Audit log (plan §5): starting a broadcast records broadcast.sent with
 * how many people it goes to — once, by the request that claimed it.
 */

const h = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>>, claimed: 1 }))

vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit')
  const { prepare } = await vi.importActual<typeof import('@/lib/audit/write')>('@/lib/audit/write')
  return {
    ...actual,
    audit: async (ctx: Parameters<typeof prepare>[0], e: Parameters<typeof prepare>[1] | Parameters<typeof prepare>[1][]) => {
      for (const x of Array.isArray(e) ? e : [e]) h.events.push(prepare(ctx, x) as unknown as Record<string, unknown>)
    },
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    broadcast: {
      updateMany: async () => ({ count: h.claimed }),
      findFirst: async () => ({ id: 'b1', name: 'Diwali offer', template_name: 'diwali_2026', total_recipients: 250 }),
      update: async () => ({}),
    },
  },
}))
vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const db = (await import('@/lib/db')).prisma
  return {
    ...actual,
    requireRoleOrApiKey: async () => ({ accountId: '11111111-1111-4111-8111-111111111111', userId: 'u1', role: 'supervisor', pageAccess: null, db }),
  }
})
vi.mock('@/lib/broadcasts/run-broadcast', () => ({ runBroadcast: vi.fn(async () => {}) }))

import { NextRequest } from 'next/server'
import { POST } from './route'

const send = () => POST(new NextRequest('https://x.test/api/broadcasts/b1/process', { method: 'POST' }), { params: Promise.resolve({ id: 'b1' }) })

describe('broadcast send — audit', () => {
  beforeEach(() => {
    h.events = []
    h.claimed = 1
  })

  it('records broadcast.sent with the recipient count', async () => {
    expect((await send()).status).toBe(202)
    expect(h.events).toHaveLength(1)
    const e = h.events[0]
    expect(e.action).toBe('broadcast.sent')
    expect(e.target_type).toBe('broadcast')
    expect(e.target_id).toBe('b1')
    expect((e.meta as Record<string, unknown>).recipients).toBe(250)
    expect(e.actor_id).toBe('u1')
  })

  it('a second press while it is already sending records nothing', async () => {
    h.claimed = 0
    await send()
    expect(h.events).toHaveLength(0)
  })
})
