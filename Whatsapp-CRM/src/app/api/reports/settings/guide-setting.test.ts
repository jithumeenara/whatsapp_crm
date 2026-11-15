import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * The AI suggestions switch (plan §8: off by default, owners/admins turn it
 * on). Saving the other report settings must never switch it off by
 * leaving it out, and turning it on must not drop the other settings.
 */

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, role: 'admin' }))

vi.mock('@/lib/auth/account', () => {
  class ForbiddenError extends Error { readonly status = 403 }
  return {
    ForbiddenError,
    requireRole: () => (h.role === 'admin' ? Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: 'admin' }) : Promise.reject(new ForbiddenError('Forbidden'))),
    toErrorResponse: (e: { message?: string; status?: number }) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
  }
})
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: () => Promise.resolve() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    leadSettings: {
      findUnique: async () => h.row,
      upsert: async (a: { update: Record<string, unknown> }) => { h.row = { sla_warn_hours: 24, funnel_stages: [], report_settings: {}, ...(h.row ?? {}), ...a.update }; return h.row },
    },
  },
}))

const put = async (body: unknown) => {
  const { PUT } = await import('./route')
  return PUT(new NextRequest('http://x/api/reports/settings', { method: 'PUT', body: JSON.stringify(body) }))
}

beforeEach(() => { h.row = null; h.role = 'admin' })

describe('AI suggestions switch', () => {
  it('is off until turned on', async () => {
    const { GET } = await import('./route')
    expect((await (await GET()).json()).guide).toEqual({ aiGuide: false })
  })
  it('turning it on keeps the other report settings', async () => {
    h.row = { report_settings: { leakHours: 12, manualSpend: [] } }
    const body = await (await put({ guide: { aiGuide: true } })).json()
    expect(body.guide).toEqual({ aiGuide: true })
    expect(body.report_settings.leakHours).toBe(12)
  })
  it('saving the other settings without it leaves it on', async () => {
    h.row = { report_settings: { leakHours: 12, manualSpend: [], aiGuide: true } }
    const body = await (await put({ report_settings: { leakHours: 6, manualSpend: [] } })).json()
    expect(body.report_settings.leakHours).toBe(6)
    expect(body.guide).toEqual({ aiGuide: true })
  })
  it('only true or false is accepted', async () => {
    expect((await put({ guide: { aiGuide: 'yes' } })).status).toBe(400)
  })
})
