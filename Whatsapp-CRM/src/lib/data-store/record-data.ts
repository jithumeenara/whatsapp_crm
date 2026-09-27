/**
 * What a row's `data` may be, when it arrives from outside.
 *
 * The records API took `body.data` exactly as sent — an array, a string,
 * a 50 MB object — and stored it. Through an API key that is an open
 * invitation to fill the database, and a non-object `data` breaks every
 * screen that reads the row. A row is a flat object of field values; a
 * signature or a list of files is the largest thing a real one holds.
 */

const MAX_KEYS = 300
const MAX_KEY_LENGTH = 100
/** A drawn signature arrives as a data: URL, which is the one large
 *  value a genuine row carries. */
const MAX_BYTES = 1_000_000

export type RecordDataResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

export function checkRecordData(raw: unknown): RecordDataResult {
  if (raw === undefined || raw === null) return { ok: true, data: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '"data" must be an object of field values.' }
  }
  const keys = Object.keys(raw)
  if (keys.length > MAX_KEYS) return { ok: false, error: `At most ${MAX_KEYS} fields per record.` }
  for (const key of keys) {
    if (!key || key.length > MAX_KEY_LENGTH || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return { ok: false, error: `"${key.slice(0, 40)}" is not a valid field key.` }
    }
  }
  let size = 0
  try {
    size = Buffer.byteLength(JSON.stringify(raw), 'utf8')
  } catch {
    return { ok: false, error: '"data" could not be read.' }
  }
  if (size > MAX_BYTES) return { ok: false, error: 'This record is too large (1 MB at most).' }
  return { ok: true, data: raw as Record<string, unknown> }
}
