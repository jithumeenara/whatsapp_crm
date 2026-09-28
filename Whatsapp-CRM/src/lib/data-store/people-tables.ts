/**
 * Tables that hold people's own submissions — registrations, bookings,
 * form entries — and so must never reach the customer-facing assistant.
 *
 * A registrations table connected as customer knowledge hands every
 * customer every other participant's name, society and WhatsApp number:
 * one "who else registered?" away. The connect screen already refuses to
 * make such a table customer-facing, but an entry connected before that
 * rule — or through another screen — kept whatever audience it was given.
 * So this is checked where the knowledge is read, every time, not only
 * where it is connected.
 *
 * Decided by how the table is used, not by guessing at column names:
 *  - the assistant registers people into it, or it has a public form;
 *  - or any row belongs to a customer, or arrived from a person through
 *    WhatsApp, a chatbot, a Flow, a web form or a payment.
 * A price list, a course calendar or a doctors' rota — typed in by staff
 * or imported — is none of these, and stays answerable.
 */

import { prisma } from '@/lib/db'

/**
 * A structured source — a Google Sheet or a table — that reads as a list
 * of people: five or more different phone numbers or email addresses.
 *
 * The case: a participants sheet (names, banks, WhatsApp numbers) was
 * connected for "both", its description saying "Only access Admin". A
 * sheet has no rows linked to customers and no form to go by, so its
 * content is the only evidence. A course calendar or fee list carries a
 * coordinator's number or two; a list of people carries one per row.
 * A branch directory with five numbers is held back too — being wrong
 * that way costs an answer, the other way costs people's numbers.
 */
const PHONE = /(?<![\d+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)|\+\d{1,3}[\s-]?\d{6,12}(?!\d)/g
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
export const CONTACT_LIST_THRESHOLD = 5

export function looksLikeContactList(text: string | null | undefined): boolean {
  if (!text) return false
  const seen = new Set<string>()
  for (const m of text.matchAll(PHONE)) {
    seen.add(m[0].replace(/\D/g, '').slice(-10))
    if (seen.size >= CONTACT_LIST_THRESHOLD) return true
  }
  for (const m of text.matchAll(EMAIL)) {
    seen.add(m[0].toLowerCase())
    if (seen.size >= CONTACT_LIST_THRESHOLD) return true
  }
  return false
}

/** Row sources that are a person sending in their own details. */
export const SUBMITTED_SOURCES = ['whatsapp_ai', 'chatbot', 'whatsapp_flow', 'web_form', 'payment'] as const

/** Of these tables, the ones that hold people's submissions. */
export async function peopleTableIds(accountId: string, tableIds: readonly string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(tableIds.filter(Boolean)))
  if (ids.length === 0) return new Set()

  const [flagged, submitted] = await Promise.all([
    prisma.dataTable.findMany({
      where: {
        account_id: accountId,
        id: { in: ids },
        OR: [{ ai_can_register: true }, { form_token: { not: null } }],
      },
      select: { id: true },
    }),
    prisma.dataRecord.groupBy({
      by: ['table_id'],
      where: {
        account_id: accountId,
        table_id: { in: ids },
        OR: [{ contact_id: { not: null } }, { source: { in: [...SUBMITTED_SOURCES] } }],
      },
    }),
  ])
  return new Set([...flagged.map((t) => t.id), ...submitted.map((r) => r.table_id)])
}
