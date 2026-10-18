/**
 * Who may receive a broadcast — one rule for the send and for every count
 * and preview, so the number a person sees before sending is the number
 * that is sent.
 *
 * Left out: numbers that are not numbers (email-only contacts, website
 * visitors), anyone who said they want no more messages, blocked contacts,
 * and contacts merged into another one.
 */

import type { Prisma } from '@prisma/client'

export interface SendableFields {
  phone: string | null
  opt_in_status?: string | null
  blocked_at?: Date | string | null
  merged_into_contact_id?: string | null
}

export function sendableContactWhere(accountId: string): Prisma.ContactWhereInput {
  return {
    account_id: accountId,
    merged_into_contact_id: null,
    blocked_at: null,
    opt_in_status: { not: 'opted_out' },
    NOT: [{ phone: { startsWith: 'email:' } }, { phone: { startsWith: 'web:' } }],
  }
}

export function isSendableContact(c: SendableFields): boolean {
  const phone = c.phone ?? ''
  if (!phone || phone.startsWith('email:') || phone.startsWith('web:')) return false
  if (c.opt_in_status === 'opted_out') return false
  if (c.blocked_at) return false
  if (c.merged_into_contact_id) return false
  return true
}
