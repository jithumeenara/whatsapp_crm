/**
 * Contacts as the lead, follow-up and task screens should see them: with
 * a number somebody can ring.
 *
 * A website visitor's `phone` is an internal placeholder ("web:…") and an
 * email-only contact's is "email:…" — the column cannot be empty and is
 * the contact's identity. Those screens call, message and display
 * `contact.phone` in a dozen places, so rather than teach each of them,
 * the API hands them the callable number in that field: the alternate a
 * website visitor typed into the chat, or empty when there is none. The
 * identity in the database is untouched.
 *
 * Walks any response shape and changes only objects that look like a
 * contact (a string `phone`). Everything else passes through as is.
 */

import { isPlaceholderPhone } from './validate'

export function withCallablePhones<T>(value: T): T {
  return walk(value) as T
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk)
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(obj)) out[key] = walk(child)
  if (typeof out.phone === 'string' && isPlaceholderPhone(out.phone)) {
    const alternate = typeof out.alternate_phone === 'string' ? out.alternate_phone.trim() : ''
    out.phone = alternate
  }
  return out
}
