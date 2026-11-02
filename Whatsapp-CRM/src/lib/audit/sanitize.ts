/**
 * What may enter an audit record. Pure, so the never-store list is tested
 * (audit.test.ts). Applied to every string the log keeps — labels,
 * reasons, changes, meta, tool arguments — not only to named fields,
 * because an Aadhaar or bank number can arrive in free text.
 */

/** Keys whose values are never kept, only the fact that they changed. */
const SECRET_KEY = /(pass(word)?|secret|token|otp|\bpin\b|cvv|api[_-]?key|private|signature|totp|mfa|session|cookie|authori[sz]ation|encrypted|credential|hash|salt|aadha+r|(^|_)pan(_?no|_?number)?$|ifsc|account_?(no|number)|card_?(no|number)?$|bank_?(no|account))/i

/** Fields whose content is long or private: kept as "(N chars)". */
const BODY_KEY = /(^|_)(body|content|text|message|prompt|notes?|description|html|markup|transcript|knowledge|instructions?|system_prompt|template_body)$/i

// Control characters and the two Unicode line separators (log injection).
// Built from escapes so no raw control byte ever sits in this file.
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]+', 'g')

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}-\d{4}$/

/** Replaces lone UTF-16 surrogates (they cannot be stored as UTF-8). */
function wellFormed(s: string): string {
  const w = (s as string & { toWellFormed?: () => string }).toWellFormed
  return typeof w === 'function' ? w.call(s) : s.replace(/[�-�](?![�-�])|(?<![�-�])[�-�]/g, '�')
}

export const MAX_STRING = 200
export const MAX_REASON = 500
export const MAX_EVENT_BYTES = 8 * 1024

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Masks numbers that look like phones, IDs, bank or card numbers, and
 *  emails. Record ids (UUIDs) are left whole: a run of digits inside one
 *  is not a phone number, and a masked id could never be looked up. */
export function maskText(input: string): string {
  const ids = input.match(UUID_ANYWHERE)
  if (!ids) return maskPlain(input)
  const parts = input.split(UUID_ANYWHERE)
  return parts.map((p, i) => maskPlain(p) + (ids[i] ?? '')).join('')
}

function maskPlain(input: string): string {
  return input
    // 8+ digits, possibly split by spaces or dashes: keep the last four.
    .replace(/(?<![\w])(\+?\d[\d\s-]{6,}\d)(?![\w])/g, (run) => {
      // Dates are not identifiers: 2026-11-02, 02-11-2026.
      if (DATE_LIKE.test(run.trim())) return run
      const digits = run.replace(/\D/g, '')
      if (digits.length < 8) return run
      return `••••${digits.slice(-4)}`
    })
    // PAN-like (ABCDE1234F)
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '••••PAN')
    .replace(/\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1•••@$2')
}

/** One line, no control characters, capped (log injection: OWASP). */
export function cleanText(input: unknown, max = MAX_STRING): string | null {
  if (input === null || input === undefined) return null
  const s = wellFormed(String(input)).replace(CONTROL, ' ').trim()
  if (!s) return null
  const masked = maskText(s)
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}

/** A single value as it may be stored inside changes/meta. */
export function cleanValue(key: string, value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null
  if (isSecretKey(key)) return '[secret]'
  if (typeof value === 'string') {
    if (BODY_KEY.test(key) && value.length > 0) return `(${value.length} chars)`
    return cleanText(value)
  }
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) >= 1e7 ? maskText(String(value)) : value
  if (typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (depth >= 2) return '(nested)'
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((v) => cleanValue(key, v, depth + 1))
    return value.length > 20 ? [...items, `(+${value.length - 20} more)`] : items
  }
  if (typeof value === 'object') return cleanObject(value as Record<string, unknown>, depth + 1)
  return cleanText(String(value))
}

export function cleanObject(obj: Record<string, unknown> | null | undefined, depth = 0): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj).slice(0, 60)) {
    if (v === undefined) continue
    out[cleanText(k, 60) ?? 'key'] = cleanValue(k, v, depth)
  }
  return out
}

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v)
  const x = norm(a)
  const y = norm(b)
  if (typeof x === 'object' || typeof y === 'object') return JSON.stringify(x ?? null) === JSON.stringify(y ?? null)
  return (x ?? null) === (y ?? null)
}

/** Changed fields only: { field: [before, after] }, each value cleaned.
 *  A field missing from `after` was not part of the update and is skipped. */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts: { only?: readonly string[]; skip?: readonly string[] } = {},
): Record<string, [unknown, unknown]> | null {
  if (!before && !after) return null
  const skip = new Set(['updated_at', 'created_at', 'id', 'account_id', ...(opts.skip ?? [])])
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of keys) {
    if (skip.has(k)) continue
    if (opts.only && !opts.only.includes(k)) continue
    if (after && !(k in after)) continue
    const b = before?.[k]
    const a = after?.[k]
    if (sameValue(b, a)) continue
    if (isSecretKey(k)) { out[k] = ['[secret]', '[secret changed]']; continue }
    out[k] = [cleanValue(k, b), cleanValue(k, a)]
  }
  return Object.keys(out).length ? out : null
}

/** Field names only, for config whose values must never be stored. */
export function changedFieldNames(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...keys]
    .filter((k) => !['updated_at', 'created_at'].includes(k) && !!after && k in after && !sameValue(before?.[k], after[k]))
    .sort()
}
