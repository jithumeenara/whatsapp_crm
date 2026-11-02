import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug: POST /api/meta-ads/lead-forms upserted on meta_form_id alone. That
 * id is unique across accounts, so a form already linked to another
 * account was switched on in that account and its row returned to the
 * caller. It must be refused, with nothing written.
 */

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; account_id: string; meta_form_id: string; is_active: boolean; name: string }>,
  writes: 0,
}))

vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/audit', () => ({ auditCtx: () => ({}) }))
vi.mock('@/lib/audit/config-change', () => ({ auditConfigChange: async () => {} }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, requireRole: async () => ({ accountId: ME, userId: 'u1', role: 'agent' }) }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    leadAdForm: {
      findUnique: async (a: { where: { meta_form_id: string } }) => h.rows.find((r) => r.meta_form_id === a.where.meta_form_id) ?? null,
      upsert: async (a: { where: { meta_form_id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        h.writes++
        const row = h.rows.find((r) => r.meta_form_id === a.where.meta_form_id)
        if (row) return Object.assign(row, a.update)
        const created = { id: 'new-form', ...a.create } as (typeof h.rows)[number]
        h.rows.push(created)
        return created
      },
    },
  },
}))

import { POST } from './route'

const post = (body: unknown) =>
  POST(new Request('http://x/api/meta-ads/lead-forms', { method: 'POST', body: JSON.stringify(body) }) as never)

describe('lead form sync — account boundary', () => {
  beforeEach(() => {
    h.writes = 0
    h.rows = [{ id: 'theirs', account_id: OTHER, meta_form_id: 'F1', is_active: false, name: 'Their form' }]
  })

  it("refuses a form linked to another account, without switching it on or returning it", async () => {
    const res = await post({ meta_form_id: 'F1', page_id: 'P1' })
    expect(res.status).toBe(409)
    expect(h.rows[0].is_active).toBe(false)
    expect(h.writes).toBe(0)
    expect(JSON.stringify(await res.json())).not.toContain('Their form')
  })

  it('still links a new form to this account', async () => {
    const res = await post({ meta_form_id: 'F2', page_id: 'P1' })
    expect(res.status).toBe(200)
    expect(h.rows.find((r) => r.meta_form_id === 'F2')?.account_id).toBe(ME)
  })
})
