import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Bug (Hospital, 2026-11-16): two patients on one phone number could not
 * both be booked. New lead with an existing number dropped the second
 * name and offered "Create anyway", which put the second lead on the same
 * contact — so both leads showed one name, and renaming changed both.
 *
 * Now a lead can be for a PERSON on the number (contact_people):
 *  - a new person on a known number saves straight away (not a duplicate);
 *  - the duplicate box appears only for the same person (or for the
 *    number's owner when no person is chosen);
 *  - age / gender / address typed on the lead go to that person, never the
 *    contact (so the other people on the number keep theirs);
 *  - a person id from another workspace or another number is refused.
 */

const ACC = 'acc'
const h = vi.hoisted(() => ({
  contacts: [] as Array<Record<string, unknown>>,
  people: [] as Array<Record<string, unknown>>,
  leads: [] as Array<Record<string, unknown>>,
  contactUpdates: [] as Array<Record<string, unknown>>,
  detailsSaved: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/audit', () => ({ audit: async () => {}, auditCtx: () => ({}) }))
vi.mock('@/lib/auth/account', () => ({
  requireRoleOrApiKey: async () => ({ accountId: 'acc', userId: 'me', role: 'agent' }),
  assertPageAccess: () => {},
  toErrorResponse: (e: unknown) => { throw e },
}))
vi.mock('@/lib/socket', () => ({ emitToAccount: () => {} }))
vi.mock('@/lib/contacts/callable', () => ({ withCallablePhones: (x: unknown) => x }))
vi.mock('@/lib/leads/origin', () => ({ leadOrigin: async () => ({ whatsapp_config_id: null, ad_id: null }) }))
vi.mock('@/lib/leads/owned-refs', () => ({ checkOwnedRefs: async () => null }))
vi.mock('@/lib/leads/contact-details', async () => {
  const actual = await vi.importActual<typeof import('@/lib/leads/contact-details')>('@/lib/leads/contact-details')
  return { ...actual, saveContactDetails: async (_a: string, contactId: string, d: Record<string, unknown>) => { h.detailsSaved.push({ contactId, ...d }) } }
})
vi.mock('@/lib/contacts/find-or-create', () => ({
  findOrCreateContact: async ({ phone }: { phone: string }) => {
    const c = h.contacts.find((x) => x.phone === phone)
    return { contact: c, created: false }
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    contact: {
      findFirst: async ({ where }: { where: { id: string; account_id: string } }) => h.contacts.find((c) => c.id === where.id && c.account_id === where.account_id) ?? null,
      update: async (a: Record<string, unknown>) => { h.contactUpdates.push(a); return {} },
    },
    contactPerson: {
      findFirst: async ({ where }: { where: { id: string; account_id: string; contact_id: string } }) =>
        h.people.find((p) => p.id === where.id && p.account_id === where.account_id && p.contact_id === where.contact_id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const p = { id: `p${h.people.length + 1}`, ...data }; h.people.push(p); return p },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const p = h.people.find((x) => x.id === where.id)!; Object.assign(p, data); return p },
    },
    lead: {
      findMany: async ({ where }: { where: { contact_id: string; account_id: string; person_id?: string | null } }) =>
        h.leads.filter((l) => l.contact_id === where.contact_id && l.account_id === where.account_id && ('person_id' in where ? (l.person_id ?? null) === where.person_id : true))
          .map((l) => ({ ...l, assignee: null, activities: [] })),
      create: async ({ data }: { data: Record<string, unknown> }) => { const l = { id: `L${h.leads.length + 1}`, ...data, contact: null, assignee: null }; h.leads.push(l); return l },
    },
    leadActivity: { create: async () => ({}) },
  },
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('http://x/api/leads', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.contacts = [{ id: 'C1', account_id: ACC, name: 'Ravi (father)', phone: '919847012345' }, { id: 'C9', account_id: 'other', name: 'X', phone: '911111111111' }]
  h.people = [{ id: '11111111-1111-4111-8111-111111111111', account_id: ACC, contact_id: 'C1', name: 'Anu' }, { id: '99999999-9999-4999-8999-999999999999', account_id: 'other', contact_id: 'C9', name: 'Not yours' }]
  h.leads = [{ id: 'L0', account_id: ACC, contact_id: 'C1', person_id: null, title: 'Ravi', status: 'new' }]
  h.contactUpdates = []; h.detailsSaved = []
})

describe('two people on one phone number', () => {
  it('a new person on a number that already has a lead saves straight away, with their own name', async () => {
    const res = await post({ title: 'Meera', new_contact: { phone: '9847012345' }, new_person: { name: 'Meera', relation: 'daughter' } })
    expect(res.status).toBe(201)
    const meera = h.people.find((p) => p.name === 'Meera')
    expect(meera).toMatchObject({ account_id: ACC, contact_id: 'C1', relation: 'daughter' })
    expect(h.leads.at(-1)).toMatchObject({ contact_id: 'C1', person_id: meera!.id })
    expect(h.contactUpdates).toEqual([]) // the father's contact name is untouched
  })

  it('age / gender / address on that lead go to the person, not the shared contact', async () => {
    await post({ title: 'Meera', contact_id: 'C1', new_person: { name: 'Meera' }, age: '9', gender: 'female' })
    expect(h.people.find((p) => p.name === 'Meera')).toMatchObject({ age: 9, gender: 'female' })
    expect(h.detailsSaved).toEqual([])
  })

  it('the same person with an open lead still gets the duplicate box', async () => {
    h.leads.push({ id: 'L1', account_id: ACC, contact_id: 'C1', person_id: '11111111-1111-4111-8111-111111111111', title: 'Anu', status: 'new' })
    const res = await post({ title: 'Anu again', contact_id: 'C1', person_id: '11111111-1111-4111-8111-111111111111' })
    expect(res.status).toBe(409)
  })

  it("an existing person with no lead yet is not a duplicate even though the number has one", async () => {
    const res = await post({ title: 'Anu', contact_id: 'C1', person_id: '11111111-1111-4111-8111-111111111111' })
    expect(res.status).toBe(201)
    expect(h.leads.at(-1)).toMatchObject({ person_id: '11111111-1111-4111-8111-111111111111' })
  })

  it('no person chosen: the number owner, duplicate box as before', async () => {
    const res = await post({ title: 'Ravi again', contact_id: 'C1' })
    expect(res.status).toBe(409)
  })

  it("a person id from another workspace or another number is refused", async () => {
    expect((await post({ title: 'x', contact_id: 'C1', person_id: '99999999-9999-4999-8999-999999999999' })).status).toBe(404)
    expect((await post({ title: 'x', contact_id: 'C1', person_id: "x' OR 1=1" })).status).toBe(400)
  })

  it('a new person needs a plain-text name', async () => {
    expect((await post({ title: 'x', contact_id: 'C1', new_person: { name: { $ne: '' } } })).status).toBe(400)
    expect((await post({ title: 'x', contact_id: 'C1', new_person: { name: '  ' } })).status).toBe(400)
    expect((await post({ title: 'x', contact_id: 'C1', new_person: { name: 'y'.repeat(121) } })).status).toBe(400)
  })
})
