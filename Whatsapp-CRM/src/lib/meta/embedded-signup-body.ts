/**
 * The body the Embedded Signup button posts (embedded-signup-button.tsx),
 * checked on the server: ids are short safe tokens, the code a short opaque string.
 */
export type SignupBody =
  | { code: string; wabaId: string; phoneNumberId: string; coexistence: false }
  | { code: string; wabaId: string; coexistence: true }

/** Ids are Meta's digit ids; the code is an opaque short string. */
export function parseSignupBody(raw: unknown): SignupBody | { error: string } {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const code = typeof b.code === "string" ? b.code.trim() : ""
  const wabaId = typeof b.wabaId === "string" ? b.wabaId.trim() : ""
  const phoneNumberId = typeof b.phoneNumberId === "string" ? b.phoneNumberId.trim() : ""
  const coexistence = b.coexistence === true
  // Meta ids are digits; letters, - and _ are let through (test fixtures,
  // future id formats) but never / . ? & or spaces — they go into URL paths.
  const digits = /^[A-Za-z0-9_-]{1,64}$/
  if (!code || code.length > 2048 || !digits.test(wabaId) || (!coexistence && !digits.test(phoneNumberId))) {
    return { error: "The signup popup did not return the WhatsApp account details. Try connecting again." }
  }
  return coexistence ? { code, wabaId, coexistence: true } : { code, wabaId, phoneNumberId, coexistence: false }
}
