/**
 * A flow_token that says who the Flow was sent to.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * A WhatsApp Flow backed by our endpoint saves its answers when the
 * customer presses Submit — and Meta's request to that endpoint carries
 * the answers and the flow_token, and nothing else. No phone number. The
 * chatbot's own "Send Flow" step already records the token it sends, so
 * those rows find their customer. A Flow sent any other way — a template
 * with a Flow button, which is how a broadcast opens a registration form
 * — was sent with a random token, and every row it produced was saved
 * with nobody attached: no name in the Data Store, no way to alert
 * "Anu (98765…) just registered", no way for the assistant to find it.
 *
 * So those sends now carry `wct1.<number>.<nonce>.<signature>`. The
 * signature is an HMAC over the rest with the server's secret, so a
 * token cannot be made up to attach a row to somebody else's number.
 * The number is the recipient's own — Meta and the recipient's phone
 * both already hold it — and is used only to look up that customer
 * inside the Flow's own account.
 */

import crypto from 'crypto'

const PREFIX = 'wct1'
const LABEL = 'whatsapp-flow-token/v1:'

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY ?? null
}

function sign(key: string, body: string): string {
  return crypto.createHmac('sha256', key).update(LABEL + body).digest('base64url').slice(0, 32)
}

/** A token for a Flow sent to `to`. Falls back to a random one — which
 *  simply links to nobody, the old behaviour — when there is no secret
 *  or the number is not a number. */
export function mintFlowToken(to: string): string {
  const digits = to.replace(/\D/g, '')
  const key = secret()
  if (!key || digits.length < 8 || digits.length > 15) return crypto.randomUUID()
  const nonce = crypto.randomBytes(6).toString('base64url')
  const body = `${digits}.${nonce}`
  return `${PREFIX}.${body}.${sign(key, body)}`
}

/** The number a token was minted for, or null for anything else —
 *  a random token, a chatbot run's token, or one that does not verify. */
export function phoneFromFlowToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string' || !token.startsWith(`${PREFIX}.`) || token.length > 120) return null
  const key = secret()
  if (!key) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [, digits, nonce, signature] = parts
  if (!/^\d{8,15}$/.test(digits) || !/^[A-Za-z0-9_-]{1,16}$/.test(nonce)) return null
  const expected = Buffer.from(sign(key, `${digits}.${nonce}`))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  return digits
}
