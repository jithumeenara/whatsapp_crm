/**
 * References and private links for "check your details" — server only
 * (Node's crypto). The rules that the browser also uses live in
 * sheet-verify.ts.
 */

import crypto from 'crypto'
// ── References ─────────────────────────────────────────────────────────

/** Crockford base32: no I, L, O or U, so nothing reads as another. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A new reference: 12 random characters in three groups (60 bits). */
export function makeRef(): string {
  const bytes = crypto.randomBytes(12)
  let s = ''
  for (const b of bytes) s += ALPHABET[b % 32]
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`
}

/** As typed or pasted: case, spaces and look-alikes forgiven. */
export function normRef(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '')
}

// ── Private links ──────────────────────────────────────────────────────

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET is not set')
  return `sheet-verify:${s}`
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, 22)
}

export interface LinkClaim {
  /** The verification's id. */
  v: string
  /** The row's reference. */
  r: string
  /** Key version: raised to cancel every link sent before. */
  k: number
}

/** The link's last part: the claim and its signature. */
export function signLink(claim: LinkClaim): string {
  const payload = Buffer.from(JSON.stringify([claim.v, claim.r, claim.k])).toString('base64url')
  return `${payload}.${sign(payload)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The claim, only when the signature is right. Never throws. */
export function readLink(token: unknown): LinkClaim | null {
  if (typeof token !== 'string' || token.length > 300) return null
  const [payload, mac, extra] = token.split('.')
  if (!payload || !mac || extra !== undefined) return null
  let want: string
  try {
    want = sign(payload)
  } catch {
    return null
  }
  const a = Buffer.from(mac)
  const b = Buffer.from(want)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const [v, r, k] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown[]
    if (typeof v !== 'string' || !UUID.test(v) || typeof r !== 'string' || !r || r.length > 40 || typeof k !== 'number' || !Number.isInteger(k)) return null
    return { v, r, k }
  } catch {
    return null
  }
}
