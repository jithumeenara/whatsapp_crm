/**
 * RFC 6238 TOTP (Google Authenticator / Authy / 1Password-compatible),
 * implemented directly against Node's built-in `crypto` — no third-party
 * TOTP library. Base32 encode/decode (RFC 4648) is also hand-rolled since
 * the standard `otpauth://` secret format requires it and Node has no
 * built-in base32 codec.
 */
import crypto from "crypto"

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const STEP_SECONDS = 30
const DIGITS = 6

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength))
}

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "")
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  // Counter is a 64-bit big-endian integer; JS numbers are safe up to
  // 2^53, more than enough for a Unix-time-derived counter.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter % 2 ** 32, 4)

  const hmac = crypto.createHmac("sha1", secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0")
}

/** Verifies a 6-digit code against the current time step, tolerating clock
 *  drift of `window` steps either side (default ±30s, i.e. one step). */
export function verifyTotp(base32Secret: string, token: string, window = 1): boolean {
  const clean = token.replace(/\D/g, "")
  if (clean.length !== DIGITS) return false
  const secret = base32Decode(base32Secret)
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS)
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const expected = hotp(secret, counter + errorWindow)
    if (timingSafeEqual(expected, clean)) return true
  }
  return false
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return crypto.timingSafeEqual(bufA, bufB)
}

/** Standard otpauth:// URI — scanning this (as a QR code) is what
 *  populates Google Authenticator / Authy / etc. */
export function buildOtpauthUri(secret: string, accountLabel: string, issuer = "WhatsApp CRM"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
