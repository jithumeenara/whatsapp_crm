/**
 * A contact is a customer's personal data. The audit log records WHICH of
 * their personal fields changed, never the values (an audit row is kept for
 * years and cannot be edited, so a phone number or address written into it
 * could never be erased on request). Other fields — opt-in status, say —
 * keep their before/after diff. Pure.
 */

import { changedFieldNames, diff } from './sanitize'

export const CONTACT_PERSONAL_FIELDS: readonly string[] = [
  'name', 'phone', 'phone_normalized', 'email', 'address', 'gender', 'age',
  'alternate_phone', 'company', 'avatar', 'avatar_url',
]

const isPersonal = (k: string) => CONTACT_PERSONAL_FIELDS.includes(k)

/**
 * The `changes` / `meta.fields` pair for a contact change.
 * `only` limits it to the fields this request set (as AuditEntry.only).
 */
export function contactAuditChange(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  only?: readonly string[],
): { changes: Record<string, [unknown, unknown]> | null; fields: string[] } {
  const keys = only ?? [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  const personal = keys.filter(isPersonal)
  const pick = (o: Record<string, unknown> | null | undefined) =>
    o ? Object.fromEntries(Object.entries(o).filter(([k]) => personal.includes(k))) : o
  const fields = changedFieldNames(pick(before), pick(after))
  const changes = diff(before, after, { only: keys.filter((k) => !isPersonal(k)) })
  return { changes, fields }
}
