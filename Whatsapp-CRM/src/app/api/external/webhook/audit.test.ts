import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A lead or contact created by the external webhook is recorded with the
 * webhook as the actor (webhook:external). The business rows still borrow
 * the owner's id for their user_id column, but the audit log never names
 * the owner as having done it. A bad secret is a throttled rejection.
 */

const OWNER = '44444444-4444-4444-8444-444444444444'
const ACC = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  calls: [] as Array<{ ctx: Record<string, unknown>; entry: Record<string, unknown> }>,
  secretOk: true,
  created: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/audit/write', async (orig) => {
  const real = await orig<typeof import('@/lib/audit/write')>()
  return {
    ...real,
    audit: vi.fn(async (ctx: Record<string, unknown>, e: unknown) => {
      for (const entry of (Array.isArray(e) ? e : [e]) as Array<Record<string, unknown>>) h.calls.push({ ctx, entry })
    }),
  }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => (h.secretOk ? [{ account_id: ACC }] : [])),
    profile: { findFirst: vi.fn(async () => ({ user_id: OWNER })) },
    contact: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => { h.created.push(a.data); return { id: 'contact-1' } }),
      update: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => { h.created.push(a.data); return { id: 'lead-1' } }),
      update: vi.fn(),
    },
    leadActivity: { create: vi.fn(async () => ({})) },
  },
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { resetThrottleForTests, flushThrottled } from '@/lib/audit/throttle'
import { prepare } from '@/lib/audit/write'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const tick = () => new Promise((r) => setTimeout(r, 0))

function post(body: unknown, secret = 's3cret', ip = `10.1.0.${Math.floor(Math.random() * 250)}`) {
  return POST(new NextRequest(`http://x/api/external/webhook?secret=${secret}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  h.calls.length = 0
  h.created.length = 0
  h.secretOk = true
  resetThrottleForTests()
  __resetRateLimitForTests()
})

describe('external webhook audit', () => {
  it('records webhook:external as the actor of the contact and lead it creates, never the owner', async () => {
    const res = await post({ contact: { name: 'Anu', phone: '+919847012345' }, lead: { title: 'Course enquiry' } })
    expect(res.status).toBe(200)
    await tick()

    // The business rows still carry the owner id (unchanged behaviour).
    expect(h.created.every((d) => d.user_id === OWNER)).toBe(true)

    const received = h.calls.filter((c) => c.entry.action === 'system.webhook_received')
    expect(received.map((c) => c.entry.target)).toEqual([{ type: 'contact', id: 'contact-1' }, { type: 'lead', id: 'lead-1' }])
    for (const c of received) {
      const row = prepare(c.ctx as never, c.entry as never)
      expect(row.actor_type).toBe('webhook')
      expect(row.actor_id).toBe('external')
      expect(row.on_behalf_of).toBeNull()
      expect(JSON.stringify(row)).not.toContain(OWNER)
      expect(JSON.stringify(row)).not.toContain('9847012345')
    }
  })

  it('a burst of wrong secrets is one counted rejection', async () => {
    h.secretOk = false
    for (let i = 0; i < 5; i++) expect((await post({ contact: { name: 'x' } }, 'wrong')).status).toBe(401)
    expect(h.calls).toHaveLength(0)
    await flushThrottled()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].entry).toMatchObject({ action: 'system.webhook_rejected', meta: { provider: 'external', count: 5 } })
  })
})
