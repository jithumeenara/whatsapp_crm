/**
 * Contacts that are probably one person — "Find duplicates" on Contacts.
 *
 * Grouped only on something that identifies a person:
 *   - the same phone number (last 10 digits: "+91 94950 43668",
 *     "09495043668" and "9495043668" are one number);
 *   - one's alternate number equal to another's number;
 *   - the same email, ignoring case.
 * The same name alone never groups — two people share names all the time.
 * Website-visitor and email-only placeholders ("web:…", "email:…", "tg:…") are not
 * phone numbers. Nothing here merges; a person confirms each group.
 */

import { isPlaceholderPhone } from './validate'

export interface DupContact {
  id: string
  name: string | null
  phone: string | null
  alternate_phone: string | null
  email: string | null
  instagram_id?: string | null
  facebook_id?: string | null
  created_at: Date | string
  /** Messages/conversations on record — the busier record is kept by default. */
  activity?: number
}

export interface DupGroup {
  /** Contacts in the group; the suggested one to keep first. */
  contacts: DupContact[]
  reasons: string[]
}

function phoneKey(v: string | null | undefined): string | null {
  if (!v || isPlaceholderPhone(v)) return null
  const d = v.replace(/\D/g, '')
  // 10–15 digits is a phone number; an Instagram/Facebook id stored in the
  // phone field is longer, and is not compared.
  return d.length >= 10 && d.length <= 15 ? d.slice(-10) : null
}

function emailKey(v: string | null | undefined): string | null {
  const e = (v ?? '').trim().toLowerCase()
  return e.includes('@') && e.length <= 254 ? e : null
}

function hasRealPhone(c: DupContact): boolean {
  return phoneKey(c.phone) !== null
}

function hasRealName(c: DupContact): boolean {
  const n = (c.name ?? '').trim()
  return n !== '' && n.replace(/\D/g, '') !== (c.phone ?? '').replace(/\D/g, '')
}

/** The record to keep by default: a real number, a real name, more
 *  history, then the oldest. */
export function suggestKeep(a: DupContact, b: DupContact): number {
  const score = (c: DupContact) => (hasRealPhone(c) ? 4 : 0) + (hasRealName(c) ? 2 : 0) + (c.email ? 1 : 0)
  return score(b) - score(a)
    || (b.activity ?? 0) - (a.activity ?? 0)
    || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
}

export function findDuplicateGroups(contacts: readonly DupContact[], limit = 200): DupGroup[] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const c of contacts) parent.set(c.id, c.id)

  const reasonsFor = new Map<string, Set<string>>()
  const link = (ids: string[], reason: string) => {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i])
    if (ids.length > 1) {
      for (const id of ids) {
        const s = reasonsFor.get(id) ?? new Set<string>()
        s.add(reason)
        reasonsFor.set(id, s)
      }
    }
  }

  const byPhone = new Map<string, string[]>()
  const byEmail = new Map<string, string[]>()
  for (const c of contacts) {
    const p = phoneKey(c.phone)
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), c.id])
    const e = emailKey(c.email)
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), c.id])
  }
  for (const ids of byPhone.values()) link(ids, 'Same phone number')
  for (const ids of byEmail.values()) link(ids, 'Same email')
  for (const c of contacts) {
    const alt = phoneKey(c.alternate_phone)
    const others = alt ? (byPhone.get(alt) ?? []).filter((id) => id !== c.id) : []
    if (others.length) link([c.id, ...others], 'Alternate number matches')
  }

  const groups = new Map<string, DupContact[]>()
  for (const c of contacts) {
    const r = find(c.id)
    groups.set(r, [...(groups.get(r) ?? []), c])
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      contacts: [...g].sort(suggestKeep),
      reasons: [...new Set(g.flatMap((c) => [...(reasonsFor.get(c.id) ?? [])]))],
    }))
    .sort((a, b) => b.contacts.length - a.contacts.length)
    .slice(0, limit)
}
