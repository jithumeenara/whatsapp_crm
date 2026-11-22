/**
 * Several people on one phone number (migration 178).
 *
 * The contact is the NUMBER — its WhatsApp chat and its owner. Each person
 * booked through that number (a child, a parent, a colleague) is a
 * ContactPerson, and a lead can be for one of them (leads.person_id). A lead
 * without a person is for the number's owner, exactly as before.
 *
 * Rules kept here, not in each route:
 *  - every person is loaded with BOTH the workspace id and the contact id,
 *    so an id from another workspace or another number never resolves;
 *  - fields are checked one by one (name 1–120 plain text; age, gender and
 *    address with the same rules as the contact's; relation up to 40);
 *  - what a lead shows: the person's details, falling back to the
 *    contact's for any the person does not have (the business's choice).
 */

import { prisma } from '@/lib/db'
import { contactDetailsPatch, type ContactDetails } from '@/lib/leads/contact-details'

export const PERSON_NAME_MAX = 120
export const PERSON_RELATION_MAX = 40
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isPersonId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

const plain = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

export interface PersonFields {
  name?: string
  relation?: string | null
  age?: number | null
  gender?: string | null
  address?: string | null
}

/**
 * Checked fields from a body. `requireName` for a new person. Only the
 * fields the body names are returned (an empty value clears it), so the same
 * check serves create and edit.
 */
export function cleanPerson(body: unknown, requireName: boolean): { ok: true; value: PersonFields } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const out: PersonFields = {}
  if ('name' in b || requireName) {
    if (typeof b.name !== 'string') return { ok: false, error: 'Give the person a name.' }
    const name = plain(b.name)
    if (!name) return { ok: false, error: 'Give the person a name.' }
    if ([...name].length > PERSON_NAME_MAX) return { ok: false, error: `A name can be at most ${PERSON_NAME_MAX} characters.` }
    out.name = name
  }
  if ('relation' in b) {
    if (b.relation !== null && b.relation !== undefined && typeof b.relation !== 'string') return { ok: false, error: 'Relation must be text.' }
    const r = typeof b.relation === 'string' ? plain(b.relation) : ''
    if ([...r].length > PERSON_RELATION_MAX) return { ok: false, error: `Relation can be at most ${PERSON_RELATION_MAX} characters.` }
    out.relation = r || null
  }
  const details = contactDetailsPatch(b)
  if ('error' in details) return { ok: false, error: details.error }
  if ('age' in details) out.age = details.age ?? null
  if ('gender' in details) out.gender = details.gender ?? null
  if ('address' in details) out.address = details.address ?? null
  return { ok: true, value: out }
}

/** Lead-form details (strings) as person fields. */
export function detailsAsPerson(d: ContactDetails): PersonFields {
  const out: PersonFields = {}
  if (d.age) out.age = Number(d.age)
  if (d.gender) out.gender = d.gender
  if (d.address) out.address = d.address
  return out
}

/** One person of this workspace AND this number, or null. */
export async function findPerson(accountId: string, contactId: string, personId: string) {
  if (!isPersonId(personId)) return null
  return prisma.contactPerson.findFirst({ where: { id: personId, account_id: accountId, contact_id: contactId } })
}

export async function createPerson(accountId: string, contactId: string, userId: string | null, f: PersonFields & { name: string }) {
  return prisma.contactPerson.create({
    data: {
      account_id: accountId,
      contact_id: contactId,
      name: f.name,
      relation: f.relation ?? null,
      age: f.age ?? null,
      gender: f.gender ?? null,
      address: f.address ?? null,
      created_by: userId,
    },
  })
}

/** What a lead shows: the person's details, the contact's where the person has none. */
export function displayDetails(
  person: { name: string; age: number | null; gender: string | null; address: string | null; relation?: string | null } | null,
  contact: { name?: string | null; age?: number | null; gender?: string | null; address?: string | null } | null,
): { name: string | null; age: number | null; gender: string | null; address: string | null; relation: string | null; isPerson: boolean } {
  if (!person) {
    return { name: contact?.name ?? null, age: contact?.age ?? null, gender: contact?.gender ?? null, address: contact?.address ?? null, relation: null, isPerson: false }
  }
  return {
    name: person.name,
    age: person.age ?? contact?.age ?? null,
    gender: person.gender ?? contact?.gender ?? null,
    address: person.address ?? contact?.address ?? null,
    relation: person.relation ?? null,
    isPerson: true,
  }
}
