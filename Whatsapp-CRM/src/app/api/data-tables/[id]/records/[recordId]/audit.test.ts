import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Audit log (plan §4): a Data Store row can be a registration — Aadhaar,
 * bank, patient details. Changing or deleting one records WHICH fields
 * changed, never their values, before or after.
 */

const h = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }))

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

const BEFORE = { name: 'Asha Menon', aadhaar: '2345 6789 0123', bank_account: '001122334455', batch: 'October' }
const AFTER = { name: 'Asha Menon', aadhaar: '9876 5432 1098', bank_account: '009988776655', batch: 'November' }

vi.mock('@/lib/data-store/access', () => ({
  dataStoreMember: async () => ({ ok: true, ctx: { accountId: '11111111-1111-4111-8111-111111111111', userId: 'u1', role: 'agent' } }),
}))
vi.mock('@/lib/auth/api-key', () => ({ verifyApiKey: async () => null }))
vi.mock('@/lib/ai/knowledge-refresh', () => ({ scheduleKnowledgeRefresh: () => {} }))
vi.mock('@/lib/data-store/record-events', () => ({ afterRecordsChanged: () => {} }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhooks: () => {} }))
vi.mock('@/lib/data-store/record-data', () => ({ checkRecordData: (data: unknown) => ({ ok: true, data }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    dataRecord: {
      findFirst: async () => ({ id: 'r1', data: BEFORE }),
      findUnique: async () => ({ id: 'r1', data: BEFORE, created_at: new Date(), updated_at: new Date() }),
      update: async (a: { data: { data: unknown } }) => ({ id: 'r1', data: a.data.data, created_at: new Date(), updated_at: new Date() }),
      delete: async () => ({}),
    },
    dataTable: { findUnique: async () => ({ name: 'Registrations' }) },
    dataField: { findMany: async () => [] },
  },
}))

import { DELETE, PUT } from './route'

const params = { params: Promise.resolve({ id: 't1', recordId: 'r1' }) }
const VALUES = ['Asha', 'Menon', '0123', '1098', '4455', '6655', '2345 6789', '9876 5432', 'October', 'November']

function expectNoValues(e: Record<string, unknown>) {
  const stored = JSON.stringify(e)
  for (const v of VALUES) expect(stored).not.toContain(v)
}

describe('Data Store record — audit keeps field names only', () => {
  beforeEach(() => { h.events = [] })

  it('an update records the changed field names and no value', async () => {
    const res = await PUT(new Request('https://x.test/', { method: 'PUT', body: JSON.stringify({ data: AFTER }) }), params)
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    const e = h.events[0]
    expect(e.action).toBe('record.updated')
    expect(e.target_type).toBe('data_record')
    expect(e.changes).toBeNull()
    expect((e.meta as Record<string, unknown>).fields).toEqual(['aadhaar', 'bank_account', 'batch'])
    expectNoValues(e)
  })

  it('a delete records the field names it held and no value', async () => {
    const res = await DELETE(new Request('https://x.test/', { method: 'DELETE' }), params)
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    const e = h.events[0]
    expect(e.action).toBe('record.deleted')
    expect((e.meta as Record<string, unknown>).fields).toEqual(['aadhaar', 'bank_account', 'batch', 'name'])
    expectNoValues(e)
  })
})
