/**
 * The account's contacts, looked up by number for an import — shared by
 * the preview check and the import itself, so both pick the same contact.
 *
 * Only real numbers: a Telegram id (tg:…), a website visitor (web:…) or an
 * email-only contact (email:…) is never matched to a phone in a file —
 * their digits can look like a number. Merged-away contacts are left out.
 * Oldest first, so of two contacts with one number the same one is used.
 */
import { prisma } from '@/lib/db'
import { isPlaceholderPhone } from './validate'
import { phoneKey, samePerson } from './csv-import'

export interface SavedContact {
  id: string
  phone: string
  name: string | null
  company: string | null
  email: string | null
  archived_at: Date | null
}

export async function loadContactsByNumber(accountId: string): Promise<(phone: string) => SavedContact | undefined> {
  const rows = await prisma.contact.findMany({
    where: { account_id: accountId, merged_into_contact_id: null },
    select: { id: true, phone: true, name: true, company: true, email: true, archived_at: true },
    orderBy: { created_at: 'asc' },
  })
  const buckets = new Map<string, SavedContact[]>()
  for (const c of rows) {
    if (!c.phone || isPlaceholderPhone(c.phone)) continue
    const k = phoneKey(c.phone)
    const list = buckets.get(k)
    if (list) list.push(c)
    else buckets.set(k, [c])
  }
  return (phone: string) => buckets.get(phoneKey(phone))?.find((c) => samePerson(c.phone, phone))
}
