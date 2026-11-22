import { beforeEach, describe, expect, it, vi } from 'vitest'

// Settings → AI → handover: "ask before connecting" (ask_first, off by
// default) and "when not sure, ask the customer first" (clarify_first, on
// by default). Changing one must never reset the other.

const h = vi.hoisted(() => ({
  stored: null as unknown,
  role: 'admin',
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => {
    if (h.role !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc', userId: 'me', role: 'admin' }
  },
  toErrorResponse: (e: { status?: number }) => new Response('{}', { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/ai/handover-consent', () => ({ officeHours: async () => ({ hours: null, open: true }) }))
vi.mock('@prisma/client', () => ({ Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) } }))
vi.mock('@/lib/db', () => ({
  prisma: {
    leadSettings: { findUnique: async () => ({ offer_enabled: false }) },
    aiConfig: { findUnique: async () => ({ handoff_alert_enabled: false, handoff_alert_numbers: [], handoff_alert_template: null }) },
    $queryRaw: async () => [{ handover_settings: h.stored }],
    $executeRawUnsafe: async () => 0,
    $executeRaw: async (q: { v: unknown[] }) => { h.stored = JSON.parse(String(q.v[0])); return 1 },
  },
}))

import { GET, PUT } from './route'
import { parseHandoverSettings } from '@/lib/ai/handover-settings'

const put = (body: unknown) => PUT(new Request('http://x/api/ai-config/handover', { method: 'PUT', body: JSON.stringify(body) }))

beforeEach(() => { h.stored = null; h.role = 'admin' })

describe('handover settings', () => {
  it('defaults: ask first off, clarify first on', async () => {
    expect(parseHandoverSettings(null)).toEqual({ ask_first: false, clarify_first: true })
    const body = await (await GET()).json()
    expect(body).toMatchObject({ ask_first: false, clarify_first: true })
  })

  it('switching clarify off keeps ask_first as it was', async () => {
    expect((await put({ ask_first: true })).status).toBe(200)
    const res = await put({ clarify_first: false })
    expect(res.status).toBe(200)
    expect(h.stored).toEqual({ ask_first: true, clarify_first: false })
    expect(await res.json()).toMatchObject({ ask_first: true, clarify_first: false })
  })

  it('refuses a non-boolean or empty body', async () => {
    expect((await put({ clarify_first: 'yes' })).status).toBe(400)
    expect((await put({})).status).toBe(400)
  })

  it('only admins may change it', async () => {
    h.role = 'agent'
    expect((await put({ clarify_first: false })).status).toBe(403)
  })
})
