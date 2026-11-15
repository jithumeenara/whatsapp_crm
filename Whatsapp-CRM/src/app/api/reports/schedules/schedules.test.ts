import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Scheduled reports API: owners and admins only; every record loaded with
 * the account id (another business's schedule is 404); the body's
 * account / creator are never used; a double "send now" is one send.
 */

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const S1 = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  created: [] as Array<Record<string, unknown>>,
  rows: new Map<string, Record<string, unknown>>(),
  sends: 0,
  release: null as null | (() => void),
}))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  const rank: Record<string, number> = { viewer: 0, agent: 1, supervisor: 2, admin: 3, owner: 4 }
  return {
    ForbiddenError,
    requireRole: (min: string) => (rank[h.role] >= rank[min] ? Promise.resolve({ userId: U1, accountId: 'acc-1', role: h.role }) : Promise.reject(new ForbiddenError('Forbidden'))),
    assertPageAccess: () => {},
    toErrorResponse: (e: { message?: string; status?: number }) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}), audit: () => Promise.resolve() }))
vi.mock('@/lib/ai/human-date', () => ({ businessTimezone: () => Promise.resolve('Asia/Kolkata') }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: () => NextResponse.json({}, { status: 429 }) }))
vi.mock('@/lib/reports/doc/registry', () => ({ findReport: (k: string) => ({ key: k, title: 'Lead report' }) }))
vi.mock('@/lib/reports/schedule/team', () => ({
  SCHEDULE_FIELDS: {},
  loadScheduleTeam: () => Promise.resolve({ roles: new Map([[U1, 'owner'], [U2, 'supervisor']]), members: [] }),
}))
vi.mock('@/lib/reports/schedule/sweep', () => ({
  sendScheduledReport: () => { h.sends += 1; return new Promise<string>((r) => { h.release = () => r('Sent: 1 by email.') }) },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    scheduledReport: {
      findMany: () => Promise.resolve([]),
      count: () => Promise.resolve(0),
      create: ({ data }: { data: Record<string, unknown> }) => { h.created.push(data); return Promise.resolve({ id: S1, ...data }) },
      findFirst: ({ where }: { where: { id: string; account_id: string } }) => {
        const r = h.rows.get(where.id)
        return Promise.resolve(r && r.account_id === where.account_id ? r : null)
      },
      updateMany: () => Promise.resolve({ count: 1 }),
      deleteMany: () => Promise.resolve({ count: 1 }),
    },
  },
}))

const body = { report_key: 'leads', frequency: 'weekly', day: 1, send_hour: 9, recipient_ids: [U1, U2], by_chat: true, by_email: false }
const req = (url: string, method: string, b?: unknown) => new NextRequest(url, { method, body: b ? JSON.stringify(b) : undefined })

beforeEach(() => {
  h.role = 'admin'; h.created = []; h.sends = 0; h.release = null
  h.rows = new Map([[S1, { id: S1, account_id: 'acc-1', report_key: 'leads', frequency: 'weekly', day: 1, send_hour: 9, recipient_ids: [U1], by_chat: true, by_email: false, enabled: true }]])
})

describe('POST /api/reports/schedules', () => {
  it('a supervisor cannot add one', async () => {
    h.role = 'supervisor'
    const { POST } = await import('./route')
    expect((await POST(req('http://x/api/reports/schedules', 'POST', body))).status).toBe(403)
    expect(h.created).toEqual([])
  })
  it("an admin adds one for their own business; the body's account and creator are ignored", async () => {
    const { POST } = await import('./route')
    const res = await POST(req('http://x/api/reports/schedules', 'POST', { ...body, account_id: 'evil', created_by: 'evil' }))
    expect(res.status).toBe(200)
    expect(h.created[0]).toMatchObject({ account_id: 'acc-1', created_by: U1, report_key: 'leads' })
  })
  it('a money report to a supervisor is refused in plain words', async () => {
    const { POST } = await import('./route')
    const res = await POST(req('http://x/api/reports/schedules', 'POST', { ...body, report_key: 'ads' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/may not see/)
  })
})

describe('PATCH / DELETE /api/reports/schedules/[id]', () => {
  it("another business's schedule is not found", async () => {
    h.rows.set(S1, { ...h.rows.get(S1)!, account_id: 'other' })
    const { PATCH, DELETE } = await import('./[id]/route')
    const p = { params: Promise.resolve({ id: S1 }) }
    expect((await PATCH(req(`http://x/api/reports/schedules/${S1}`, 'PATCH', { enabled: false }), p)).status).toBe(404)
    expect((await DELETE(req(`http://x/api/reports/schedules/${S1}`, 'DELETE'), { params: Promise.resolve({ id: S1 }) })).status).toBe(404)
  })
  it('a made-up id is not found before any lookup', async () => {
    const { DELETE } = await import('./[id]/route')
    expect((await DELETE(req('http://x/api/reports/schedules/x', 'DELETE'), { params: Promise.resolve({ id: "1' OR 1=1" }) })).status).toBe(404)
  })
})

describe('POST /api/reports/schedules/[id]/send', () => {
  it('a double press is one send: the second is refused while the first runs', async () => {
    const { POST } = await import('./[id]/send/route')
    const first = POST(req(`http://x/api/reports/schedules/${S1}/send`, 'POST'), { params: Promise.resolve({ id: S1 }) })
    await new Promise((r) => setTimeout(r, 10))
    const second = await POST(req(`http://x/api/reports/schedules/${S1}/send`, 'POST'), { params: Promise.resolve({ id: S1 }) })
    expect(second.status).toBe(409)
    h.release?.()
    expect((await first).status).toBe(200)
    expect(h.sends).toBe(1)
  })
})
