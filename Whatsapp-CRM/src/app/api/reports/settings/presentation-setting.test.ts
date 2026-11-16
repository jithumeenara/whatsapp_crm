import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * The reports' brand colour and category name live in report_settings next
 * to the funnel's other settings. A save that does not send them (an older
 * screen, another tab) must keep the saved ones; sending them changes them;
 * sending an empty value clears them.
 */

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: () => Promise.resolve({ userId: 'u1', accountId: 'acc-1', role: 'admin' }),
  toErrorResponse: (e: { message?: string; status?: number }) => NextResponse.json({ error: String(e?.message) }, { status: e?.status ?? 500 }),
}))
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

beforeEach(() => { h.row = { report_settings: { leakHours: 12, manualSpend: [], brandColor: '8b0a5c', categoryLabel: 'Speciality' } } })

describe('report look (brand colour, category name)', () => {
  it('saving the other settings without them keeps the saved ones', async () => {
    const body = await (await put({ report_settings: { leakHours: 6, manualSpend: [] } })).json()
    expect(body.report_settings.leakHours).toBe(6)
    expect(body.presentation).toEqual({ brandColor: '8b0a5c', categoryLabel: 'Speciality' })
  })
  it('sending them changes them', async () => {
    const body = await (await put({ report_settings: { leakHours: 6, manualSpend: [], brandColor: '#1F6FEB', categoryLabel: 'Course' } })).json()
    expect(body.presentation).toEqual({ brandColor: '1f6feb', categoryLabel: 'Course' })
  })
  it('sending empty values clears them', async () => {
    const body = await (await put({ report_settings: { leakHours: 6, manualSpend: [], brandColor: '', categoryLabel: '' } })).json()
    expect(body.presentation).toEqual({ brandColor: null, categoryLabel: null })
  })
  it('a bad colour is a plain 400', async () => {
    const res = await put({ report_settings: { leakHours: 6, manualSpend: [], brandColor: 'blue' } })
    expect(res.status).toBe(400)
    expect(h.row?.report_settings).toMatchObject({ brandColor: '8b0a5c' })
  })
})
