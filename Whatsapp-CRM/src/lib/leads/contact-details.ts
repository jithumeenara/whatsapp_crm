/**
 * A contact's gender, age and address — typed into "New lead", New
 * contact, the contact's Details or the lead page. Kept on the contact
 * (contacts.gender / age / address, migration 148), not the lead, so the
 * next lead, a broadcast or the chatbot sees them.
 */
import { prisma } from '@/lib/db'

export const GENDERS = ['male', 'female', 'trans', 'prefer_not_to_say'] as const
export const MAX_ADDRESS = 500

export interface ContactDetails {
  gender?: string
  age?: string
  address?: string
}

type Checked<T> = T | { error: string }

function checkGender(v: unknown): Checked<string | null> {
  const g = typeof v === 'string' ? v.trim() : ''
  if (!g) return null
  return (GENDERS as readonly string[]).includes(g) ? g : { error: 'Choose a gender from the list.' }
}

function checkAge(v: unknown): Checked<string | null> {
  const raw = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!raw) return null
  if (!/^\d{1,3}$/.test(raw) || Number(raw) > 120) return { error: 'Age must be a whole number from 0 to 120.' }
  return String(Number(raw))
}

function checkAddress(v: unknown): Checked<string | null> {
  const a = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : ''
  if (!a) return null
  return a.length > MAX_ADDRESS ? { error: `Address can be at most ${MAX_ADDRESS} characters.` } : a
}

const isError = (v: unknown): v is { error: string } => !!v && typeof v === 'object' && 'error' in v

/** The details from a request body, checked. Blank fields are left out. */
export function cleanContactDetails(body: Record<string, unknown>): ContactDetails | { error: string } {
  const out: ContactDetails = {}
  const g = checkGender(body.gender)
  if (isError(g)) return g
  if (g) out.gender = g
  const age = checkAge(body.age)
  if (isError(age)) return age
  if (age) out.age = age
  const addr = checkAddress(body.address)
  if (isError(addr)) return addr
  if (addr) out.address = addr
  return out
}

export function hasContactDetails(d: ContactDetails): boolean {
  return !!(d.gender || d.age || d.address)
}

/**
 * For editing a contact: only the fields the body names, an empty value
 * clearing it. Ready for prisma.contact.update.
 */
export function contactDetailsPatch(body: Record<string, unknown>): { gender?: string | null; age?: number | null; address?: string | null } | { error: string } {
  const out: { gender?: string | null; age?: number | null; address?: string | null } = {}
  if ('gender' in body) {
    const g = checkGender(body.gender)
    if (isError(g)) return g
    out.gender = g
  }
  if ('age' in body) {
    const a = checkAge(body.age)
    if (isError(a)) return a
    out.age = a === null ? null : Number(a)
  }
  if ('address' in body) {
    const a = checkAddress(body.address)
    if (isError(a)) return a
    out.address = a
  }
  return out
}

/** Writes the details onto a contact of this account (blank ones left as they are). */
export async function saveContactDetails(accountId: string, contactId: string, d: ContactDetails): Promise<void> {
  if (!hasContactDetails(d)) return
  await prisma.contact.updateMany({
    where: { id: contactId, account_id: accountId },
    data: {
      ...(d.gender ? { gender: d.gender } : {}),
      ...(d.age ? { age: Number(d.age) } : {}),
      ...(d.address ? { address: d.address } : {}),
    },
  })
}
