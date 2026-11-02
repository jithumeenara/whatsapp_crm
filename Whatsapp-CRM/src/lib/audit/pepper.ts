/**
 * Pseudonymous identifiers for the audit log. A failed sign-in with an
 * email nobody has must still be traceable ("the same address was tried
 * from 40 places") without the log ever holding the address itself.
 *
 * The key is AUDIT_PEPPER when set (kept apart from the database), else
 * one derived from the session secret. Either way the stored value is an
 * HMAC: pseudonymous, not anonymous — a guessed address can be checked
 * against it by someone holding the key, which is the point.
 */

import crypto from 'crypto'

let cachedKey: { source: string; key: Buffer } | null = null

function pepperKey(): Buffer {
  const own = process.env.AUDIT_PEPPER?.trim()
  const source = own ? `own:${own}` : `derived:${process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'unset'}`
  if (cachedKey?.source === source) return cachedKey.key
  const key = own
    ? Buffer.from(own, 'utf8')
    : crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'unset').update('audit-pepper').digest()
  cachedKey = { source, key }
  return key
}

/** Normalises the way sign-in does: trimmed, lower-case. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** HMAC-SHA256 of the normalised email, hex. */
export function emailHmac(email: string): string {
  return crypto.createHmac('sha256', pepperKey()).update(normaliseEmail(email)).digest('hex')
}

/** A short keyed hash of any target (email, user id, phone) for samples
 *  and grouping. 16 hex chars: enough to tell targets apart, short enough
 *  to list five in one event. */
export function targetHash(value: string): string {
  return crypto.createHmac('sha256', pepperKey()).update(`t:${normaliseEmail(value)}`).digest('hex').slice(0, 16)
}
