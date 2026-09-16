/**
 * Letting the assistant take a registration, for any business.
 *
 * Nothing here knows what is being registered for. An account defines a
 * Data Store table — programme registrations, service bookings, job
 * applications, whatever their business actually takes — marks the fields
 * that are required, and ticks a box to say the assistant may write into
 * it. The assistant reads that definition. There is no shape of form
 * written into this code.
 *
 * The flow it supports is deliberately two-stage: ask for the required
 * fields, save, *then* offer the rest. A customer who has answered four
 * questions and been told they are registered will often answer four
 * more; a customer facing twelve questions before anything is saved
 * frequently answers none, and there is no record they were ever
 * interested.
 *
 * ── Why the validation below is so unforgiving ──────────────────────
 *
 * This is the one place in the app where a language model writes to the
 * database. Everything a model produces is a suggestion, including the
 * field names — it will occasionally invent a key, answer a dropdown with
 * a word that isn't one of the options, or put a sentence where a number
 * belongs. So nothing is trusted: unknown keys are refused rather than
 * stored, every value is checked against its declared type, and a `select`
 * must match an option exactly. A rejection comes back as a readable
 * sentence, which the model can act on by asking the customer again.
 */

import { prisma } from '@/lib/db'
// Shared with the table's settings panel, which counts what the assistant
// will ask for. Kept in one place so the count shown to the account and
// the questions actually asked can never disagree.
import { AI_FILLABLE_FIELD_TYPES } from '@/lib/data-store/types'

export interface RegistrationField {
  key: string
  label: string
  type: string
  required: boolean
  /** For `select`: the only values that will be accepted. */
  options?: string[]
}

export interface RegistrationForm {
  table_id: string
  name: string
  slug: string
  description: string | null
  required_fields: RegistrationField[]
  optional_fields: RegistrationField[]
}

function toField(f: {
  field_key: string
  label: string
  field_type: string
  required: boolean
  options: unknown
}): RegistrationField {
  const options = Array.isArray(f.options)
    ? (f.options as unknown[]).map((o) =>
        typeof o === 'string' ? o : String((o as { label?: string; value?: string })?.label ?? (o as { value?: string })?.value ?? ''),
      ).filter(Boolean)
    : undefined
  return {
    key: f.field_key,
    label: f.label,
    type: f.field_type,
    required: f.required,
    ...(options && options.length ? { options } : {}),
  }
}

/**
 * How long a form definition is reused before being re-read.
 *
 * Matches the flow engine's policy cache. Two queries per inbound
 * message is not much on its own, but it sits directly between a
 * customer's message and their reply, and a form definition changes when
 * somebody edits a table — minutes apart at most, never mid-conversation.
 * A minute of staleness costs nothing; the round trip is paid on every
 * single message.
 */
const FORM_CACHE_MS = 60_000
const formCache = new Map<string, { at: number; forms: RegistrationForm[] }>()

/** Drops an account's cached forms, so a table edit shows up at once
 *  rather than up to a minute later. */
export function invalidateRegistrationForms(accountId: string): void {
  formCache.delete(accountId)
}

/** Every table this account has opened to the assistant. */
export async function listRegistrationForms(accountId: string): Promise<RegistrationForm[]> {
  const cached = formCache.get(accountId)
  if (cached && Date.now() - cached.at < FORM_CACHE_MS) return cached.forms

  const tables = await prisma.dataTable.findMany({
    where: { account_id: accountId, ai_can_register: true },
    orderBy: { sort_order: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      fields: {
        orderBy: { sort_order: 'asc' },
        select: {
          field_key: true,
          label: true,
          field_type: true,
          required: true,
          options: true,
        },
      },
    },
  })

  const forms = tables.map((t) => {
    const fillable = t.fields.filter((f) => AI_FILLABLE_FIELD_TYPES.has(f.field_type)).map(toField)
    return {
      table_id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      required_fields: fillable.filter((f) => f.required),
      optional_fields: fillable.filter((f) => !f.required),
    }
  })

  formCache.set(accountId, { at: Date.now(), forms })
  return forms
}

export type ValidationResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; problems: string[] }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** Deliberately loose: people write numbers with spaces, dashes and a
 *  country code or not, and refusing a real number because of a hyphen
 *  is a worse failure than storing one. */
const PHONE = /^[+]?[\d\s\-()]{7,20}$/

/**
 * Check what the model produced against what the table actually declares.
 *
 * Returns readable problems rather than codes, because they go straight
 * back to the model as a tool result and become the next question it asks
 * the customer.
 */
export function validateValues(
  fields: RegistrationField[],
  raw: Record<string, unknown>,
  { requireAll }: { requireAll: boolean },
): ValidationResult {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const problems: string[] = []
  const values: Record<string, unknown> = {}

  // Anything not declared on this table is refused outright. A model that
  // invents "student_name" when the field is "name" must be told, not
  // quietly obeyed — a stored key nothing reads is a record that looks
  // complete and is not.
  for (const key of Object.keys(raw)) {
    if (!byKey.has(key)) {
      problems.push(`There is no field called "${key}" on this form.`)
    }
  }

  for (const field of fields) {
    const supplied = raw[field.key]
    const isEmpty =
      supplied === undefined || supplied === null || String(supplied).trim() === ''

    if (isEmpty) {
      if (requireAll && field.required) {
        problems.push(`"${field.label}" is required.`)
      }
      continue
    }

    const text = String(supplied).trim()

    switch (field.type) {
      case 'number': {
        const n = Number(text.replace(/,/g, ''))
        if (!Number.isFinite(n)) {
          problems.push(`"${field.label}" has to be a number — got "${text}".`)
          continue
        }
        values[field.key] = n
        break
      }
      case 'date': {
        const d = new Date(text)
        if (Number.isNaN(d.getTime())) {
          problems.push(`"${field.label}" has to be a date — got "${text}".`)
          continue
        }
        // Stored as a plain date string, matching what the Data Store UI
        // writes, so a record created here looks like one typed by hand.
        values[field.key] = d.toISOString().slice(0, 10)
        break
      }
      case 'email': {
        if (!EMAIL.test(text)) {
          problems.push(`"${field.label}" does not look like an email address.`)
          continue
        }
        values[field.key] = text
        break
      }
      case 'phone': {
        if (!PHONE.test(text)) {
          problems.push(`"${field.label}" does not look like a phone number.`)
          continue
        }
        values[field.key] = text
        break
      }
      case 'url': {
        try {
          const u = new URL(text)
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme')
          values[field.key] = u.toString()
        } catch {
          problems.push(`"${field.label}" has to be a web address starting http:// or https://.`)
        }
        break
      }
      case 'select': {
        const allowed = field.options ?? []
        // Matched case-insensitively, then stored in the table's own
        // spelling: a customer saying "sub staff" should not create a
        // value that no filter or report will ever match.
        const hit = allowed.find((o) => o.toLowerCase() === text.toLowerCase())
        if (!hit) {
          problems.push(
            `"${field.label}" has to be one of: ${allowed.join(', ')} — got "${text}".`,
          )
          continue
        }
        values[field.key] = hit
        break
      }
      default: {
        // Plain text. Capped so one runaway generation cannot write a
        // novel into a cell.
        values[field.key] = text.slice(0, 2_000)
      }
    }
  }

  return problems.length ? { ok: false, problems } : { ok: true, values }
}
