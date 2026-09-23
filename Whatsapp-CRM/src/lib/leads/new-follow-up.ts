/**
 * Checking a follow-up someone typed in, before anything is written.
 *
 * Kept apart from the route so the rules can be tested without a
 * database: what counts as a phone number, how far back or ahead a
 * reminder may be set, and how long a description may run.
 */

import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/** A reminder set a few minutes in the past is a slow form, not a
 *  mistake. Anything older than this is a wrong date. */
const PAST_GRACE_MS = 10 * 60 * 1000
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000
export const MAX_DESCRIPTION = 2000
const MAX_NAME = 120

/**
 * Digits only, with India's country code added to a bare ten-digit
 * mobile number — the form every agent here types ("9847012345"), and
 * the form every contact is stored in ("919847012345"). Anything else
 * must already carry its country code. Null when it is not a number.
 */
export function normalizeEnteredPhone(raw: string): string | null {
  let digits = sanitizePhoneForMeta(raw.trim())
  if (/^0[6-9]\d{9}$/.test(digits)) digits = digits.slice(1)
  if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`
  return isValidE164(digits) ? digits : null
}

export type FollowUpInput =
  | {
      ok: true
      contactId: string | null
      phone: string | null
      name: string | null
      dueAt: Date
      description: string
    }
  | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseFollowUpInput(body: unknown, now = new Date()): FollowUpInput {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request' }
  const b = body as Record<string, unknown>

  const contactId = typeof b.contact_id === 'string' && b.contact_id ? b.contact_id : null
  if (contactId && !UUID.test(contactId)) return { ok: false, error: 'Invalid contact' }

  let phone: string | null = null
  if (!contactId) {
    const raw = typeof b.phone === 'string' ? b.phone : ''
    if (!raw.trim()) return { ok: false, error: 'Pick a contact or enter a phone number' }
    phone = normalizeEnteredPhone(raw)
    if (!phone) return { ok: false, error: 'Enter a valid phone number, e.g. 9847012345 or 919847012345' }
  }

  const name = typeof b.name === 'string' ? b.name.trim().slice(0, MAX_NAME) || null : null

  const dueRaw = typeof b.due_at === 'string' ? b.due_at : ''
  const dueAt = new Date(dueRaw)
  if (!dueRaw || Number.isNaN(dueAt.getTime())) return { ok: false, error: 'Choose a date and time' }
  if (dueAt.getTime() < now.getTime() - PAST_GRACE_MS) return { ok: false, error: 'That time has already passed' }
  if (dueAt.getTime() > now.getTime() + MAX_AHEAD_MS) return { ok: false, error: 'Choose a time within the next year' }

  const description = typeof b.description === 'string' ? b.description.trim() : ''
  if (!description) return { ok: false, error: 'Add a description — what the call is about' }
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: `Keep the description under ${MAX_DESCRIPTION} characters` }
  }

  return { ok: true, contactId, phone, name, dueAt, description }
}
