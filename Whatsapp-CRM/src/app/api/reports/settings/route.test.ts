import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Settings → Reports: admin and owner only, refused before anything is
 * read; a bad funnel is a plain 400 with nothing written; a good save
 * writes only funnel_stages / report_settings, on this account's row.
 */

const h = vi.hoisted(() => ({
  role: 'admin' as string,
  reads: 0,
  upserts: [] as Array<{ where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }>,
  row: null as Record<string, unknown> | null,
  audits: [] as Array<{ action: string; fields?: string[] }>,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: string) => {
      if (!hasMinRole(h.role as never, min as never)) throw new actual.ForbiddenError('no')
      return { accountId: 'acc-1', userId: 'u1', role: h.role }
    },
  }
})
vi.mock('@/lib/audit/config-change', () => ({
  auditConfigChange: async (_ctx: unknown, action: string, opts: { fields?: string[] }) => {
    h.audits.push({ action, fields: opts.fields })
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    leadSettings: {
      findUnique: async () => {
        h.reads++
        return h.row
      },
      upsert: async (a: { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        h.upserts.push(a)
        h.row = { sla_warn_hours: 24, funnel_stages: [], report_settings: {}, ...(h.row ?? {}), ...a.update }
        return h.row
      },
    },
  },
}))

import { GET, PUT } from './route'

const put = (body: unknown) =>
  PUT(new NextRequest('http://x/api/reports/settings', { method: 'PUT', body: JSON.stringify(body) }))

describe('/api/reports/settings', () => {
  beforeEach(() => {
    h.role = 'admin'
    h.reads = 0
    h.upserts = []
    h.row = null
    h.audits = []
  })

  it('refuses supervisors, agents and viewers before reading or writing', async () => {
    for (const role of ['supervisor', 'agent', 'viewer']) {
      h.role = role
      expect((await GET()).status).toBe(403)
      expect((await put({ funnel_stages: [{ label: 'Won', outcome: 'won' }] })).status).toBe(403)
    }
    expect(h.reads).toBe(0)
    expect(h.upserts).toHaveLength(0)
  })

  it('GET gives defaults for an account with no settings row, plus templates', async () => {
    h.role = 'owner'
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.funnel_stages).toEqual([])
    expect(body.report_settings).toEqual({ leakHours: null, manualSpend: [] })
    expect(body.sla_warn_hours).toBe(24)
    expect(body.templates.length).toBeGreaterThan(0)
  })

  it('an invalid funnel is a plain 400 and nothing is written', async () => {
    const empty = await put({ funnel_stages: [{ label: '  ', outcome: 'open' }] })
    expect(empty.status).toBe(400)
    expect((await empty.json()).error).toBe('Every stage needs a name.')
    expect((await put({ funnel_stages: [{ label: 'A' }, { label: 'a' }] })).status).toBe(400)
    expect((await put({ funnel_stages: 'Won' })).status).toBe(400)
    expect((await put({ report_settings: { leakHours: 0 } })).status).toBe(400)
    expect((await put({})).status).toBe(400)
    const blankAmount = await put({ report_settings: { manualSpend: [{ month: '2026-10', source: 'Posters', amount: '', currency: 'INR' }] } })
    expect(blankAmount.status).toBe(400)
    expect((await blankAmount.json()).error).toBe('Each spend row needs an amount.')
    expect(h.upserts).toHaveLength(0)
  })

  it('a valid save writes only the two fields, on this account, and returns what was saved', async () => {
    const res = await put({
      funnel_stages: [{ label: 'Enquiry', outcome: 'open' }, { label: 'Joined', outcome: 'won' }],
      report_settings: { leakHours: 12, manualSpend: [{ month: '2026-10', source: 'Newspaper', amount: 5000, currency: 'INR' }] },
      account_id: 'someone-else',
      sla_warn_hours: 1,
      role: 'owner',
    })
    expect(res.status).toBe(200)
    expect(h.upserts).toHaveLength(1)
    const u = h.upserts[0]
    expect(u.where).toEqual({ account_id: 'acc-1' })
    expect(Object.keys(u.update).sort()).toEqual(['funnel_stages', 'report_settings'])
    expect(u.create.account_id).toBe('acc-1')
    expect(Object.keys(u.create).sort()).toEqual(['account_id', 'funnel_stages', 'report_settings'])

    const body = await res.json()
    expect(body.funnel_stages.map((s: { label: string }) => s.label)).toEqual(['Enquiry', 'Joined'])
    expect(body.report_settings.leakHours).toBe(12)
    expect(body.report_settings.manualSpend).toHaveLength(1)
    expect(h.audits).toEqual([{ action: 'config.lead_settings_changed', fields: ['funnel_stages', 'report_settings'] }])
  })

  it('saving one field leaves the other alone', async () => {
    expect((await put({ report_settings: { leakHours: null, manualSpend: [] } })).status).toBe(200)
    expect(Object.keys(h.upserts[0].update)).toEqual(['report_settings'])
  })
})
