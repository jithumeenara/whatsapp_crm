/**
 * Gender, age and address typed into "New lead" — kept on the contact,
 * not the lead, so the next lead, a broadcast or the chatbot sees them.
 * Gender is the contact's own column; age and address are Custom Fields
 * ("Age", "Address"), made the first time a business uses them.
 */
import { prisma } from '@/lib/db'

export const GENDERS = ['male', 'female', 'trans', 'prefer_not_to_say'] as const
export const MAX_ADDRESS = 500

export interface ContactDetails {
  gender?: string
  age?: string
  address?: string
}

/** The details from a request body, checked. Blank fields are left out. */
export function cleanContactDetails(body: Record<string, unknown>): ContactDetails | { error: string } {
  const out: ContactDetails = {}
  const g = typeof body.gender === 'string' ? body.gender.trim() : ''
  if (g) {
    if (!(GENDERS as readonly string[]).includes(g)) return { error: 'Choose a gender from the list.' }
    out.gender = g
  }
  const rawAge = typeof body.age === 'number' ? String(body.age) : typeof body.age === 'string' ? body.age.trim() : ''
  if (rawAge) {
    if (!/^\d{1,3}$/.test(rawAge) || Number(rawAge) > 120) return { error: 'Age must be a whole number from 0 to 120.' }
    out.age = String(Number(rawAge))
  }
  const addr = typeof body.address === 'string' ? body.address.replace(/\r\n/g, '\n').trim() : ''
  if (addr) {
    if (addr.length > MAX_ADDRESS) return { error: `Address can be at most ${MAX_ADDRESS} characters.` }
    out.address = addr
  }
  return out
}

export function hasContactDetails(d: ContactDetails): boolean {
  return !!(d.gender || d.age || d.address)
}

/** The account's Custom Field with this name (any case), made if missing. */
async function fieldId(accountId: string, userId: string, name: string, type: string): Promise<string> {
  const found = await prisma.customField.findFirst({
    where: { account_id: accountId, field_name: { equals: name, mode: 'insensitive' } },
    orderBy: { created_at: 'asc' },
    select: { id: true },
  })
  if (found) return found.id
  const made = await prisma.customField.create({
    data: { account_id: accountId, user_id: userId, field_name: name, field_type: type },
    select: { id: true },
  })
  return made.id
}

/** Writes the details onto a contact of this account. */
export async function saveContactDetails(accountId: string, userId: string, contactId: string, d: ContactDetails): Promise<void> {
  if (!hasContactDetails(d)) return
  const owned = await prisma.contact.findFirst({ where: { id: contactId, account_id: accountId }, select: { id: true } })
  if (!owned) return
  if (d.gender) await prisma.contact.updateMany({ where: { id: contactId, account_id: accountId }, data: { gender: d.gender } })
  const values: Array<[string, string, string]> = []
  if (d.age) values.push(['Age', 'number', d.age])
  if (d.address) values.push(['Address', 'text', d.address])
  for (const [name, type, value] of values) {
    const custom_field_id = await fieldId(accountId, userId, name, type)
    await prisma.contactCustomValue.upsert({
      where: { contact_id_custom_field_id: { contact_id: contactId, custom_field_id } },
      create: { contact_id: contactId, custom_field_id, value },
      update: { value },
    })
  }
}
