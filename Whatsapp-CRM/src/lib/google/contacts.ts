/**
 * Google Contacts — the connected account's contacts, brought into the CRM.
 *
 * Matched to who is already here by phone (the same last-8-digit rule the
 * rest of the app uses) or by email, ignoring case (rule 8). A match only
 * gains what it was missing — a name or an email — and is never
 * overwritten. A number written without its country code takes the code
 * most of this account's contacts already have; with none to go on, it is
 * skipped rather than saved as a number WhatsApp cannot reach.
 *
 * An import is not consent: opt_in_status stays "unknown".
 */

import { prisma } from '@/lib/db'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { googleAccessToken, isGoogleServiceEnabled } from './oauth'
import { disabledApi, disabledApiMessage, isApiDisabled } from './api-disabled'

const API = 'https://people.googleapis.com/v1'
const MAX_CONTACTS = 5000

export class ContactsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ContactsError'
  }
}

async function people<T>(token: string, path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  } catch (err) {
    throw new ContactsError(`Could not reach Google Contacts: ${err instanceof Error ? err.message : String(err)}`, 502)
  }
  if (res.ok) return (await res.json()) as T
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const msg = body.error?.message ?? `Google Contacts returned ${res.status}`
  if (isApiDisabled(msg)) {
    throw new ContactsError(disabledApiMessage(disabledApi(msg, 'Google People API')), 400)
  }
  throw new ContactsError(msg, res.status >= 400 && res.status < 500 ? res.status : 502)
}

export interface ContactGroup {
  id: string
  name: string
  count: number
}

export async function listContactGroups(accountId: string): Promise<ContactGroup[]> {
  if (!(await isGoogleServiceEnabled(accountId, 'contacts'))) throw new ContactsError('Turn on Google Contacts first.', 400)
  const token = await googleAccessToken(accountId)
  const res = await people<{ contactGroups?: Array<{ resourceName: string; name?: string; formattedName?: string; memberCount?: number; groupType?: string }> }>(
    token,
    '/contactGroups?pageSize=200',
  )
  return (res.contactGroups ?? [])
    // "My Contacts" and the user's own labels; Google's internal ones
    // (starred, chat buddies, all) are not groups anyone means.
    .filter((g) => g.groupType === 'USER_CONTACT_GROUP' || g.resourceName === 'contactGroups/myContacts')
    .map((g) => ({ id: g.resourceName, name: g.formattedName || g.name || 'Group', count: g.memberCount ?? 0 }))
}

interface Person {
  resourceName: string
  names?: Array<{ displayName?: string }>
  phoneNumbers?: Array<{ value?: string; canonicalForm?: string }>
  emailAddresses?: Array<{ value?: string }>
  organizations?: Array<{ name?: string }>
  memberships?: Array<{ contactGroupMembership?: { contactGroupResourceName?: string } }>
}

/** The country code most of this account's numbers carry, e.g. "91". */
async function usualDialCode(accountId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ cc: string }>>`
    SELECT left(phone, length(phone) - 10) AS cc
      FROM contacts
     WHERE account_id = ${accountId}::uuid AND phone ~ '^[1-9][0-9]{10,13}$'
     GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`.catch(() => [])
  return rows[0]?.cc || null
}

/** A Google phone entry as the digits WhatsApp dials, or null. */
export function toDialable(entry: { value?: string; canonicalForm?: string }, dialCode: string | null): string | null {
  const canon = entry.canonicalForm?.trim()
  if (canon && /^\+[1-9]\d{6,14}$/.test(canon)) return canon.slice(1)
  const raw = (entry.value ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('+')) {
    const d = normalizePhone(raw)
    return /^[1-9]\d{6,14}$/.test(d) ? d : null
  }
  let d = normalizePhone(raw)
  if (d.startsWith('00')) d = d.slice(2)
  else {
    d = d.replace(/^0+/, '')
    if (d.length === 10 && dialCode) d = `${dialCode}${d}`
    else if (d.length <= 10) return null
  }
  return /^[1-9]\d{6,14}$/.test(d) ? d : null
}

export interface ContactsImportResult {
  read: number
  created: number
  updated: number
  unchanged: number
  skipped: number
}

export async function importGoogleContacts(accountId: string, userId: string, groups: readonly string[] = []): Promise<ContactsImportResult> {
  if (!(await isGoogleServiceEnabled(accountId, 'contacts'))) throw new ContactsError('Turn on Google Contacts first.', 400)
  const token = await googleAccessToken(accountId)

  const persons: Person[] = []
  let pageToken = ''
  do {
    const res = await people<{ connections?: Person[]; nextPageToken?: string }>(
      token,
      `/people/me/connections?pageSize=1000&personFields=names,phoneNumbers,emailAddresses,organizations,memberships${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    )
    persons.push(...(res.connections ?? []))
    pageToken = res.nextPageToken ?? ''
  } while (pageToken && persons.length < MAX_CONTACTS)

  const wanted = new Set(groups)
  const chosen = wanted.size
    ? persons.filter((p) => p.memberships?.some((m) => wanted.has(m.contactGroupMembership?.contactGroupResourceName ?? '')))
    : persons

  const dialCode = await usualDialCode(accountId)
  const existing = await prisma.contact.findMany({
    where: { account_id: accountId, merged_into_contact_id: null },
    select: { id: true, phone: true, email: true, name: true, company: true },
  })
  const bySuffix = new Map<string, (typeof existing)[number]>()
  const byEmail = new Map<string, (typeof existing)[number]>()
  for (const c of existing) {
    const d = normalizePhone(c.phone)
    if (d.length >= 8) bySuffix.set(d.slice(-8), c)
    if (c.email) byEmail.set(c.email.trim().toLowerCase(), c)
  }

  const result: ContactsImportResult = { read: chosen.length, created: 0, updated: 0, unchanged: 0, skipped: 0 }
  for (const p of chosen.slice(0, MAX_CONTACTS)) {
    const name = p.names?.[0]?.displayName?.trim().slice(0, 200) || null
    const email = p.emailAddresses?.map((e) => e.value?.trim().toLowerCase()).find((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ?? null
    const company = p.organizations?.[0]?.name?.trim().slice(0, 200) || null
    const phones = (p.phoneNumbers ?? []).map((e) => toDialable(e, dialCode)).filter((x): x is string => Boolean(x))
    const phone = phones[0] ?? null

    const match = (phone && bySuffix.get(phone.slice(-8))) || (email && byEmail.get(email)) || null
    try {
      if (match) {
        const data: { name?: string; email?: string; company?: string; alternate_phone?: string } = {}
        if (!match.name && name) data.name = name
        if (!match.email && email) data.email = email
        if (!match.company && company) data.company = company
        if (Object.keys(data).length === 0) {
          result.unchanged++
          continue
        }
        await prisma.contact.update({ where: { id: match.id }, data })
        Object.assign(match, data)
        if (data.email) byEmail.set(data.email, match)
        result.updated++
        continue
      }
      if (!phone) {
        result.skipped++
        continue
      }
      const created = await prisma.contact.create({
        data: {
          account_id: accountId,
          user_id: userId,
          phone,
          phone_normalized: phone,
          name,
          email,
          company,
          alternate_phone: phones[1] ?? null,
          opt_in_source: 'google_contacts',
        },
        select: { id: true, phone: true, email: true, name: true, company: true },
      })
      bySuffix.set(phone.slice(-8), created)
      if (email) byEmail.set(email, created)
      result.created++
    } catch (err) {
      console.error('[google-contacts] one contact failed:', err instanceof Error ? err.message : err)
      result.skipped++
    }
  }
  return result
}
