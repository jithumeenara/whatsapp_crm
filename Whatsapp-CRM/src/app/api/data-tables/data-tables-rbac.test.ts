import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Data Store routes signed people in by reading their profile
 * directly, which checked the account and nothing else: a viewer — the
 * read-only rank — could delete a table's fields and rows, create
 * tables and import spreadsheets by calling the API. Reads stay open to
 * every member; writes need a rank.
 */

const h = vi.hoisted(() => ({
  role: 'viewer' as string,
  deleted: [] as string[],
}))

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  const { hasMinRole } = await vi.importActual<typeof import('@/lib/auth/roles')>('@/lib/auth/roles')
  return {
    ...actual,
    requireRole: async (min: 'viewer' | 'agent' | 'supervisor' | 'admin' | 'owner') => {
      if (!hasMinRole(h.role as never, min)) throw new actual.ForbiddenError(`This action requires the '${min}' role or higher`)
      return { accountId: 'acc', userId: 'u1', role: h.role }
    },
  }
})
vi.mock('@/lib/ai/registration', () => ({ invalidateRegistrationForms: () => {} }))
vi.mock('@/lib/ai/knowledge-refresh', () => ({ scheduleKnowledgeRefresh: () => {} }))
vi.mock('@/lib/data-store/record-events', () => ({ afterRecordsChanged: () => {}, afterRecordCreated: () => {} }))
vi.mock('@/lib/data-store/schema', () => ({ ensureDataStoreColumns: () => Promise.resolve() }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhooks: () => {} }))
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: () => Promise.resolve({ account_id: 'acc' }) },
    dataTable: {
      findFirst: () => Promise.resolve({ id: 't1', name: 'T', account_id: 'acc', fields: [] }),
      findUnique: () => Promise.resolve({ name: 'T' }),
      findMany: () => Promise.resolve([]),
      create: (a: { data: unknown }) => { h.deleted.push('table-create'); return Promise.resolve({ id: 't2', ...(a.data as object) }) },
    },
    dataField: {
      findFirst: () => Promise.resolve({ id: 'f1', table_id: 't1', account_id: 'acc' }),
      findMany: () => Promise.resolve([]),
      aggregate: () => Promise.resolve({ _max: { sort_order: 0 } }),
      delete: () => { h.deleted.push('field'); return Promise.resolve({}) },
      create: () => { h.deleted.push('field-create'); return Promise.resolve({ id: 'f2' }) },
    },
    dataRecord: {
      findFirst: () => Promise.resolve({ id: 'r1' }),
      findUnique: () => Promise.resolve({ id: 'r1', data: {}, created_at: new Date(), updated_at: new Date() }),
      findMany: () => Promise.resolve([]),
      count: () => Promise.resolve(0),
      delete: () => { h.deleted.push('record'); return Promise.resolve({}) },
    },
  },
}))

import { DELETE as deleteField } from './[id]/fields/[fieldId]/route'
import { DELETE as deleteRecord } from './[id]/records/[recordId]/route'
import { POST as createTable } from './route'
import { POST as createField } from './[id]/fields/route'

const req = (method: string, body?: unknown) =>
  new Request('http://x/api/data-tables', { method, body: body ? JSON.stringify(body) : undefined })

describe('Data Store writes need a rank, not just a login', () => {
  beforeEach(() => {
    h.deleted = []
  })

  it('a viewer cannot delete a field', async () => {
    h.role = 'viewer'
    const res = await deleteField(req('DELETE'), { params: Promise.resolve({ id: 't1', fieldId: 'f1' }) })
    expect(res.status).toBe(403)
    expect(h.deleted).toEqual([])
  })

  it('an agent cannot change a table’s columns either', async () => {
    h.role = 'agent'
    const res = await createField(req('POST', { label: 'X', field_type: 'text' }), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(403)
    expect(h.deleted).toEqual([])
  })

  it('a viewer cannot delete a row', async () => {
    h.role = 'viewer'
    const res = await deleteRecord(req('DELETE'), { params: Promise.resolve({ id: 't1', recordId: 'r1' }) })
    expect(res.status).toBe(403)
    expect(h.deleted).toEqual([])
  })

  it('a viewer cannot create a table', async () => {
    h.role = 'viewer'
    const res = await createTable(req('POST', { name: 'New' }))
    expect(res.status).toBe(403)
    expect(h.deleted).toEqual([])
  })

  it('a supervisor still can, and an agent can still delete a row', async () => {
    h.role = 'supervisor'
    expect((await deleteField(req('DELETE'), { params: Promise.resolve({ id: 't1', fieldId: 'f1' }) })).status).toBe(200)
    h.role = 'agent'
    expect((await deleteRecord(req('DELETE'), { params: Promise.resolve({ id: 't1', recordId: 'r1' }) })).status).toBe(200)
    expect(h.deleted).toEqual(['field', 'record'])
  })
})
