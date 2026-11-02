/**
 * For the audit log: which fields of a Data Store record changed — names
 * only. Record values are never put in an audit event, because a table can
 * hold registrations (Aadhaar, bank, patient details). See
 * docs/plans/audit-log-plan.md §4 ("raw Data Store record snapshots").
 */

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Keys added, removed or changed between two record `data` objects, sorted. */
export function changedRecordFields(before: unknown, after: unknown): string[] {
  const a = asObject(before)
  const b = asObject(after)
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys]
    .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
    .sort()
    .slice(0, 60)
}

/** The keys a record holds (for create / delete events), sorted. */
export function recordFieldNames(data: unknown): string[] {
  return Object.keys(asObject(data)).sort().slice(0, 60)
}
