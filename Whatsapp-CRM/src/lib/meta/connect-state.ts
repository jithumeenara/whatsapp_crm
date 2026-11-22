/**
 * The `state` for "Connect Instagram" / "Connect Messenger" — signed, short-lived and
 * tied to the browser that started it.
 *
 * Meta sends the browser back to our callback with ?code&state. Without a
 * signed state bound to this browser, anyone could make a logged-in owner's
 * browser finish *their* Meta login (login CSRF) and attach the attacker's
 * Page — or replay a stolen redirect. So the state carries the workspace,
 * the person and a random nonce; the same nonce sits in an httpOnly cookie
 * set when the flow began, and the callback accepts only if both match.
 *
 * Signed with a key derived for this purpose alone (never valid as another
 * kind of ticket). Free of next/server so any code may import it.
 */

import crypto from 'crypto'

export const CONNECT_STATE_TTL_MS = 10 * 60_000
export const CONNECT_NONCE_COOKIE = 'meta_connect_nonce'

function key(): Buffer {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY
  if (!value) throw new Error('No signing secret is configured.')
  return crypto.createHash('sha256').update(`${value}:meta-social-connect`).digest()
}

/** Which button started it: "Connect Instagram" or "Connect Messenger". */
export type SocialChannel = 'facebook' | 'instagram'
export const SOCIAL_CHANNELS: readonly SocialChannel[] = ['facebook', 'instagram']
export function isSocialChannel(v: unknown): v is SocialChannel {
  return v === 'facebook' || v === 'instagram'
}

/** What a one-click login connects: a messaging channel, ad accounts or catalogs. */
export type ConnectKind = SocialChannel | 'ads' | 'catalog'
export type AssetKind = 'ads' | 'catalog'
export function isConnectKind(v: unknown): v is ConnectKind {
  return isSocialChannel(v) || v === 'ads' || v === 'catalog'
}
export function isAssetKind(v: unknown): v is AssetKind {
  return v === 'ads' || v === 'catalog'
}

export interface ConnectState {
  accountId: string
  userId: string
  nonce: string
  /** Signed with the rest, so the callback saves only this channel / asset kind. */
  channel?: ConnectKind
  exp: number
}

export function newNonce(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export function signConnectState(payload: Omit<ConnectState, 'exp'>, now = Date.now()): string {
  const body: ConnectState = { ...payload, exp: now + CONNECT_STATE_TTL_MS }
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url')
  const signature = crypto.createHmac('sha256', key()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

/** Null for anything that fails, without saying which check failed. */
export function verifyConnectState(state: unknown, cookieNonce: unknown, now = Date.now()): ConnectState | null {
  try {
    if (typeof state !== 'string' || state.length > 2048) return null
    if (typeof cookieNonce !== 'string' || cookieNonce.length < 16) return null
    const [encoded, signature] = state.split('.')
    if (!encoded || !signature) return null
    const expected = crypto.createHmac('sha256', key()).update(encoded).digest('base64url')
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ConnectState
    if (typeof body.exp !== 'number' || body.exp < now) return null
    if (typeof body.accountId !== 'string' || typeof body.userId !== 'string' || typeof body.nonce !== 'string') return null
    if (body.channel !== undefined && !isConnectKind(body.channel)) return null
    const n1 = Buffer.from(body.nonce)
    const n2 = Buffer.from(cookieNonce)
    if (n1.length !== n2.length || !crypto.timingSafeEqual(n1, n2)) return null
    return body
  } catch {
    return null
  }
}

/** appsecret_proof for server-side Graph calls: HMAC-SHA256(token, app secret). */
export function appSecretProof(token: string, appSecret: string): string {
  return crypto.createHmac('sha256', appSecret).update(token).digest('hex')
}
