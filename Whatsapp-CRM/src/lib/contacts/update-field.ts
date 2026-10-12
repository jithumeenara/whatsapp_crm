/**
 * Writing one field of a contact from a conversation — a chatbot's
 * "Update contact" step, or the assistant saving what a website visitor
 * told it. One place, so both follow the same rules.
 *
 * ── The phone rule ──────────────────────────────────────────────────
 *
 * A number somebody types into a chat is unverified. On WhatsApp the
 * contact's `phone` is its identity — the number Meta delivered the
 * message from — and findExistingContact matches every future message
 * to a contact by it. If a typed number were written there, the real
 * owner of that number writing in later would land on the typist's
 * contact, and the typist's chat could then read the owner's
 * registrations and orders.
 *
 * So a typed number never becomes `phone`. It goes to `alternate_phone`:
 * staff can see and call it, registrations and bookings use it
 * (usablePhone), and it identifies nobody.
 */

import { prisma } from '@/lib/db'
import { checkEmail, checkPhone } from './validate'

export type FieldResult = { ok: true } | { ok: false; error: string }

/** Field names accepted for the built-in columns, and what they mean. */
const ALIASES: Record<string, 'name' | 'email' | 'company' | 'phone' | 'language'> = {
  name: 'name',
  full_name: 'name',
  email: 'email',
  company: 'company',
  phone: 'phone',
  mobile: 'phone',
  phone_number: 'phone',
  alternate_phone: 'phone',
  language: 'language',
  preferred_language: 'language',
}

export const STANDARD_CONTACT_FIELDS = ['name', 'email', 'phone', 'company', 'language'] as const

export async function updateContactField(args: {
  accountId: string
  contactId: string
  field: string
  value: string
}): Promise<FieldResult> {
  const field = args.field.trim()
  const value = args.value.trim()
  if (!field) return { ok: false, error: 'No field named.' }

  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, account_id: args.accountId },
    select: { id: true, phone: true, name: true },
  })
  if (!contact) return { ok: false, error: 'Contact not found.' }

  const kind: (typeof ALIASES)[string] | undefined = ALIASES[field.toLowerCase()]
  switch (kind) {
    case 'name': {
      if (!value) return { ok: false, error: 'Name is empty.' }
      const name = value.slice(0, 120)
      await prisma.contact.update({ where: { id: contact.id }, data: { name } })
      // A lead auto-created before the name was known ("Visitor ABCD")
      // takes the real one. Only a title still equal to the old name — a
      // title somebody wrote by hand is theirs.
      if (contact.name && contact.name !== name) {
        await prisma.lead
          .updateMany({
            where: { account_id: args.accountId, contact_id: contact.id, title: contact.name },
            data: { title: name },
          })
          .catch(() => {})
      }
      return { ok: true }
    }
    case 'email': {
      const checked = checkEmail(value)
      if (!checked.ok) return { ok: false, error: checked.error }
      await prisma.contact.update({ where: { id: contact.id }, data: { email: checked.value } })
      return { ok: true }
    }
    case 'company': {
      await prisma.contact.update({ where: { id: contact.id }, data: { company: value.slice(0, 160) || null } })
      return { ok: true }
    }
    case 'phone': {
      const checked = checkPhone(value)
      if (!checked.ok) return { ok: false, error: checked.error }
      // Already their own number: nothing to add.
      if (contact.phone.replace(/\D/g, '') === checked.value.replace(/\D/g, '')) return { ok: true }
      await prisma.contact.update({ where: { id: contact.id }, data: { alternate_phone: checked.value } })
      return { ok: true }
    }
    case 'language': {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { preferred_language: value ? value.slice(0, 40) : null },
      })
      return { ok: true }
    }
  }

  // Anything else is a custom field, matched by its name.
  return saveCustomField(args.accountId, contact.id, field, value)
}

async function saveCustomField(accountId: string, contactId: string, field: string, value: string): Promise<FieldResult> {
  const custom = await prisma.customField.findFirst({
    where: { account_id: accountId, field_name: { equals: field, mode: 'insensitive' } },
    select: { id: true },
  })
  if (!custom) return { ok: false, error: `No contact field called "${field}".` }
  await prisma.contactCustomValue.upsert({
    where: { contact_id_custom_field_id: { contact_id: contactId, custom_field_id: custom.id } },
    create: { contact_id: contactId, custom_field_id: custom.id, value },
    update: { value },
  })
  return { ok: true }
}

/**
 * A website visitor nobody can call back yet — no phone of their own and
 * none typed in. The assistant withholds registrations and bookings from
 * them until they share a number (customer-tools.ts, `anonymous`).
 */
export async function isAnonymousVisitor(contactId: string): Promise<boolean> {
  const contact = await prisma.contact
    .findUnique({ where: { id: contactId }, select: { phone: true, alternate_phone: true } })
    .catch(() => null)
  if (!contact) return true
  const ownPhone = contact.phone && !contact.phone.startsWith('web:') && !contact.phone.startsWith('email:')
  return !ownPhone && !contact.alternate_phone?.trim()
}
