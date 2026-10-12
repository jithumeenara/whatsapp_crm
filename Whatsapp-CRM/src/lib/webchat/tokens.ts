/**
 * The identifiers a website chat hands out, and how each is kept.
 *
 *   public key   in the install snippet, so on every page of the business's
 *                site. Identifies the widget; grants nothing on its own.
 *   session token  the visitor's bearer secret, 256 random bits. Stored
 *                only as a SHA-256 hash: a leaked database row is not a
 *                working session. A hash rather than a slow KDF because
 *                the input is random, not a password — nothing to guess.
 *   visitor id   who the visitor is, across sessions on that browser.
 *                Letters only, deliberately: contacts carry "web:<id>" in
 *                `phone`, and findExistingContact matches real numbers by
 *                their last eight digits. An id with no digits can never
 *                be mistaken for somebody's phone number.
 *
 * Pure apart from crypto, so the browser-facing rules are testable.
 */

import crypto from 'crypto'

const PUBLIC_KEY_PREFIX = 'wk_'
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'

/** Unbiased: rejection sampling, so no character is likelier than another. */
function randomFrom(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte < limit) out += alphabet[byte % alphabet.length]
      if (out.length === length) break
    }
  }
  return out
}

export function newPublicKey(): string {
  return PUBLIC_KEY_PREFIX + randomFrom(ALNUM, 24)
}

export function isPublicKeyShape(value: unknown): value is string {
  return typeof value === 'string' && /^wk_[A-Za-z0-9]{24}$/.test(value)
}

/** 26^28 ≈ 2^131 — collisions are not a practical concern. */
export function newVisitorId(): string {
  return randomFrom(LOWER, 28)
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function isSessionTokenShape(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * An IP address, unrecoverable but still comparable — enough to rate-limit
 * and spot a flood without keeping the address itself (DPDP: collect no
 * more than the purpose needs). Keyed, so the 4 billion IPv4 addresses
 * cannot simply be hashed in advance and looked up.
 */
export function hashIp(ip: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY ?? 'webchat'
  return crypto.createHmac('sha256', `${secret}:webchat-ip`).update(ip).digest('hex').slice(0, 32)
}

/** The placeholder a visitor's contact carries in the required `phone`. */
export function visitorPhone(visitorId: string): string {
  return `web:${visitorId}`
}
