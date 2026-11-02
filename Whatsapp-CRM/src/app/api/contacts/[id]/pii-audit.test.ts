import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A contact's personal details never go into the audit log as values —
 * the log is kept for years and cannot be edited, so a phone number or an
 * address written there could never be erased. Editing or creating a
 * contact records WHICH personal fields changed (meta.fields); opt-in
 * status, which is not personal, keeps its before/after.
 */

const h = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/audit', () => ({
  audit: (_ctx: unknown, entry: Record<string, unknown>) => {
    h.events.push(entry)
    return Promise.resolve()
  },
  auditCtx: () => ({ accountId: 'acc', actor: { type: 'user', id: 'u1' }, source: 'web' }),
}))
vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: () => Promise.resolve({ accountId: 'acc', userId: 'u1', role: 'agent' }),
  toErrorResponse: (err: unknown) => { throw err },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/contacts/dedupe', () => ({ isUniqueViolation: () => false, findExistingContact: () => Promise.resolve(null) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findFirst: () => Promise.resolve({
        id: 'k1', phone: '+919876543210', email: 'old@example.com', alternate_phone: null, name: 'Anu Old',
        company: null, avatar_url: null, opt_in_status: 'unknown', gender: null, age: null, address: '1 Old Street',
      }),
      update: ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'k1', ...data }),
      create: ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'k2', ...data }),
    },
  },
}))

import { PATCH } from './route'
import { POST } from '../route'

const VALUES = ['Anu New', '+919812345678', 'new@example.com', '2 New Road', 'Anu Old', '+919876543210', 'old@example.com', '1 Old Street']

function noValues(e: Record<string, unknown>) {
  const text = JSON.stringify(e)
  for (const v of VALUES) expect(text).not.toContain(v)
}

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/contacts/k1', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'k1' }) })

describe('contact audit events carry no personal values', () => {
  beforeEach(() => { h.events = [] })

  it('an edit records the personal field names only, and opt-in as a diff', async () => {
    const res = await patch({ name: 'Anu New', phone: '+91 98123 45678', email: 'new@example.com', address: '2 New Road', opt_in_status: 'opted_in' })
    expect(res.status).toBe(200)
    expect(h.events).toHaveLength(1)
    const e = h.events[0]
    expect(e.action).toBe('record.updated')
    expect(e.meta).toEqual({ fields: ['address', 'email', 'name', 'phone'] })
    expect(e.changes).toEqual({ opt_in_status: ['unknown', 'opted_in'] })
    expect(e).not.toHaveProperty('before')
    expect(e).not.toHaveProperty('after')
    noValues(e)
  })

  it('an unchanged field is not listed', async () => {
    await patch({ name: 'Anu Old', email: 'new@example.com' })
    expect(h.events[0].meta).toEqual({ fields: ['email'] })
    expect(h.events[0].changes).toBeNull()
  })

  it('creating a contact records which details were given, not what they were', async () => {
    const res = await POST(new Request('http://x/api/contacts', {
      method: 'POST',
      body: JSON.stringify({ phone: '+91 98123 45678', name: 'Anu New', email: 'new@example.com', address: '2 New Road' }),
    }) as never)
    expect(res.status).toBe(201)
    const e = h.events.find((x) => x.action === 'record.created')!
    expect(e.meta).toEqual({ fields: ['address', 'email', 'name', 'phone'] })
    noValues(e)
  })
})
