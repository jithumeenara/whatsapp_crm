import { beforeEach, describe, expect, it, vi } from 'vitest'

// WhatsApp numbers overview: the full view (live health) is owner only and
// never carries a token; ?lite=1 gives any member names only; renaming is
// owner only, scoped to this workspace, plain text, 40 characters.

const h = vi.hoisted(() => ({ role: 'owner', updated: [] as Array<{ where: unknown; data: unknown }> }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (min: string) => {
    const order = ['agent', 'supervisor', 'admin', 'owner']
    if (order.indexOf(h.role) < order.indexOf(min)) throw Object.assign(new Error('forbidden'), { status: 403 })
    return { accountId: 'acc-1', userId: 'u-1', role: h.role }
  },
  toErrorResponse: (e: { status?: number }) => new Response('{}', { status: e?.status ?? 500 }),
}))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'secret-token' }))
vi.mock('@/lib/whatsapp/number-health', () => ({
  numberHealth: async () => ({ display_phone_number: '+91 98765 43210', quality_rating: 'GREEN', messaging_limit: 'TIER_10K', is_on_biz_app: false, error: null }),
}))
vi.mock('@/lib/whatsapp/coexistence', () => ({ coexistenceSyncState: async () => null }))
vi.mock('@/lib/db', () => ({
  prisma: {
    whatsAppConfig: {
      findMany: async () => [{
        id: 'cfg-1', phone_number_id: 'pn-1', waba_id: 'w', access_token: 'sealed', status: 'connected', label: null,
        is_default: true, connect_method: 'quick', connected_at: null, last_registration_error: null,
      }],
      updateMany: async (a: { where: unknown; data: unknown }) => { h.updated.push(a); return { count: 1 } },
    },
  },
}))

import { GET } from './route'
import { PATCH } from './[id]/route'

beforeEach(() => { h.role = 'owner'; h.updated = [] })

describe('WhatsApp numbers', () => {
  it('owner sees health and the shared limit, never a token', async () => {
    const res = await GET(new Request('http://x/api/whatsapp/numbers'))
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).not.toContain('secret-token')
    expect(text).not.toContain('sealed')
    expect(JSON.parse(text)).toMatchObject({ messaging_limit: 'TIER_10K', numbers: [{ id: 'cfg-1', health: { quality_rating: 'GREEN' } }] })
  })

  it('an agent gets names only with ?lite=1, and not the full view', async () => {
    h.role = 'agent'
    expect((await GET(new Request('http://x/api/whatsapp/numbers'))).status).toBe(403)
    const lite = await (await GET(new Request('http://x/api/whatsapp/numbers?lite=1'))).json()
    expect(lite).toEqual({ numbers: [{ id: 'cfg-1', name: 'Number 1', is_default: true }] })
  })

  it('renaming: owner only, this workspace, plain text up to 40', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ label: '  Admissions\u202E' + 'x'.repeat(60) }) }), { params: Promise.resolve({ id: 'cfg-1' }) })
    expect(res.status).toBe(200)
    expect(h.updated[0]).toMatchObject({ where: { id: 'cfg-1', account_id: 'acc-1' } })
    const label = (h.updated[0].data as { label: string }).label
    expect(label.startsWith('Admissions')).toBe(true)
    expect(label).not.toContain('\u202E')
    expect(label.length).toBeLessThanOrEqual(40)
    h.role = 'admin'
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ label: 'x' }) }), { params: Promise.resolve({ id: 'cfg-1' }) })).status).toBe(403)
  })
})
