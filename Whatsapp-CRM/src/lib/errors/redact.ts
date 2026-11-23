/**
 * Takes secrets and personal numbers out of text before it is stored or
 * shown as an error.
 *
 * Error messages carry whatever the failing code had in hand: a Graph URL
 * with `access_token=` in it, an `Authorization: Bearer …` header echoed
 * back, a request body with a password or OTP, a customer's phone or
 * Aadhaar number. None of that belongs in an error list an admin reads,
 * and none of it helps recognise the error.
 *
 * Kept free of imports so server.ts and the browser can both use it.
 */

const RULES: Array<[RegExp, string]> = [
  // key=value in URLs, query strings and form bodies
  [/\b(access_token|appsecret_proof|client_secret|refresh_token|id_token|token|api_key|apikey|key|secret|password|passwd|otp|code|signature|sig)=([^&\s"'<>]+)/gi, '$1=[redacted]'],
  // "key": "value" in JSON
  [/"(access_token|refresh_token|id_token|token|api_key|apiKey|secret|client_secret|password|passwd|otp|pin|authorization|cookie|aadhaar|aadhar|card_number|cvv)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"'],
  // Authorization headers
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]'],
  // Meta tokens (EAA…), Google API keys (AIza…), payment and other live keys
  [/\bEAA[A-Za-z0-9]{20,}/g, '[meta-token]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[google-key]'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, '[api-key]'],
  [/\brzp_(live|test)_[A-Za-z0-9]{8,}/g, '[api-key]'],
  // Telegram bot tokens in URLs: /bot123456:ABC…
  [/\/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, '/bot[redacted]'],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[jwt]'],
  // Email addresses
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  // Aadhaar-like (12 digits, optionally grouped 4-4-4) and phone numbers (10+ digits)
  // (not the digit groups inside a uuid, which are ids, not people)
  [/(?<![\w-])\d{4}[ -]\d{4}[ -]\d{4}(?![\w-])/g, '[number]'],
  [/(?<![\w-])\+?\d{10,15}(?![\w-])/g, '[number]'],
]

export function redactSecrets(text: string): string {
  let out = text
  for (const [re, to] of RULES) out = out.replace(re, to)
  return out
}

/**
 * The same error, whatever ids it mentions: numbers, uuids and hex ids
 * become placeholders so a thousand "conversation 8f3… not found" lines
 * are one error with a count, not a thousand rows.
 */
export function normaliseForFingerprint(text: string): string {
  return redactSecrets(text)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}
