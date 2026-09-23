import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { findExistingContact, isUniqueViolation } from './dedupe'

export interface FoundContact {
  id: string
  name: string | null
  phone: string
}

/**
 * The contact for a number typed in by staff: the one this account
 * already has for it, or a new one.
 *
 * An existing contact is returned untouched — a name or alternate number
 * typed in a form does not overwrite what is on record. `phone` and
 * `alternatePhone` must already be normalised (see normalizeEnteredPhone).
 */
export async function findOrCreateContact(args: {
  accountId: string
  userId: string
  phone: string
  name?: string | null
  alternatePhone?: string | null
}): Promise<{ contact: FoundContact; created: boolean }> {
  const existing = await findExistingContact(args.accountId, args.phone)
  if (existing) {
    return { contact: { id: existing.id, name: existing.name ?? null, phone: existing.phone }, created: false }
  }
  try {
    const contact = await prisma.contact.create({
      data: {
        account_id: args.accountId,
        user_id: args.userId,
        phone: args.phone,
        phone_normalized: args.phone,
        name: args.name || args.phone,
        alternate_phone: args.alternatePhone && args.alternatePhone !== args.phone ? args.alternatePhone : null,
        // Typed in by staff, not the customer's own consent.
        opt_in_source: 'manual',
        opt_in_at: new Date(),
      },
      select: { id: true, name: true, phone: true },
    })
    emitToAccount(args.accountId, 'contact', { eventType: 'INSERT', new: contact, old: {} })
    return { contact, created: true }
  } catch (err) {
    // Two people adding the same new number at once.
    if (!isUniqueViolation(err)) throw err
    const again = await findExistingContact(args.accountId, args.phone)
    if (!again) throw err
    return { contact: { id: again.id, name: again.name ?? null, phone: again.phone }, created: false }
  }
}
