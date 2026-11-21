/**
 * Fields an owner types into the Messenger / Instagram connection forms
 * (token paste). Each is checked on its own before it is stored: text only,
 * a sane length, ids as digits only (they go into Graph URLs and webhook
 * lookups), no spaces inside secrets.
 */

export type ConfigFieldKind = 'id' | 'token' | 'verify_token' | 'app_secret'

const RULES: Record<ConfigFieldKind, { max: number; pattern: RegExp; label: string }> = {
  id: { max: 25, pattern: /^\d+$/, label: 'must be digits only' },
  token: { max: 2000, pattern: /^\S+$/, label: 'must not contain spaces' },
  verify_token: { max: 200, pattern: /^[\x21-\x7e]+$/, label: 'must be letters, digits or symbols without spaces' },
  app_secret: { max: 200, pattern: /^[A-Za-z0-9]+$/, label: 'must be letters and digits only' },
}

/**
 * Check the given fields of a request body. Returns the trimmed strings
 * (missing or empty → '') or a plain error naming the field.
 */
export function cleanConfigFields<K extends string>(
  body: Record<string, unknown>,
  spec: Record<K, ConfigFieldKind>,
): { ok: true; value: Record<K, string> } | { ok: false; error: string } {
  const out = {} as Record<K, string>
  for (const key of Object.keys(spec) as K[]) {
    const raw = body[key]
    if (raw === undefined || raw === null || raw === '') { out[key] = ''; continue }
    if (typeof raw !== 'string') return { ok: false, error: `${key} must be text.` }
    // The masked placeholder the form shows means "keep the saved value".
    if (/^•+$/.test(raw)) { out[key] = raw; continue }
    const v = raw.trim()
    const rule = RULES[spec[key]]
    if (v.length > rule.max) return { ok: false, error: `${key} is too long.` }
    if (v && !rule.pattern.test(v)) return { ok: false, error: `${key} ${rule.label}.` }
    out[key] = v
  }
  return { ok: true, value: out }
}
