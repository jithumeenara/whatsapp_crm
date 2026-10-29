/**
 * Finding a record by the reference a person quotes for it.
 *
 * A reference is read out on the phone or typed from a printout, so the
 * business's prefix, dashes, spaces, case and look-alike characters (O/0,
 * I/L/1) are all forgiven. References given before migration 151 were the
 * first 8 characters of the batch's (or the row's) id; those still match.
 */

/** Letters and digits only, upper case, look-alikes folded (O→0, I/L→1). */
export function plainRef(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

export interface RefRecord {
  id: string
  batch_id?: string | null
  public_ref?: string | null
}

export function refMatches(r: RefRecord, query: string): boolean {
  const q = plainRef(query)
  if (q.length < 4) return false
  if (r.public_ref) {
    const ref = plainRef(r.public_ref)
    // With the business's prefix in front ("REG-…"), or part of the code.
    if (q.endsWith(ref) || ref.includes(q)) return true
  }
  // An older reference: the id's first 8 hex characters.
  const old = plainRef((r.batch_id ?? r.id).replace(/-/g, '').slice(0, 8))
  return q.length >= 8 && q.endsWith(old)
}
