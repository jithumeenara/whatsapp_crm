/**
 * Whether a signed session token must be refused, whatever its signature
 * and `exp` say. Pure, so it can be tested without NextAuth.
 *
 * ── Why not `iat` ──────────────────────────────────────────────────
 *
 * Every re-sign of the session cookie — POST /api/heartbeat on real
 * activity, NextAuth's own refresh — stamps a fresh `iat` (jose's
 * setIssuedAt() in @auth/core's encode). Comparing "Sign out everywhere"
 * with `iat` therefore let a stolen cookie kept warm by heartbeats come
 * back newer than the sign-out, and the "absolute" 8-hour cap computed
 * from `iat` moved forward with every refresh.
 *
 * `authTime` is set once, at sign-in, in src/auth.ts's jwt callback, and
 * every refresh carries it over unchanged. Tokens from before it existed
 * fall back to `iat`, which is exactly the old behaviour.
 */

import { IDLE_TIMEOUT_MS } from './session-timing'

/** Even an active user signs in again after this long. */
export const ABSOLUTE_SESSION_MAX_AGE_S = 8 * 60 * 60

export interface SessionClaims {
  iat?: unknown
  authTime?: unknown
}

/** Seconds since the epoch at which this person actually signed in. */
export function signedInAt(token: SessionClaims): number | null {
  if (typeof token.authTime === 'number') return token.authTime
  if (typeof token.iat === 'number') return token.iat
  return null
}

export function tokenIsStale(
  token: SessionClaims,
  invalidatedAt: Date | null,
  nowMs: number = Date.now(),
): boolean {
  const at = signedInAt(token)
  if (at === null) return false
  if (invalidatedAt && invalidatedAt.getTime() / 1000 > at) return true
  return nowMs / 1000 - at > ABSOLUTE_SESSION_MAX_AGE_S
}

/**
 * Past the idle limit (session-timing.ts) — no real activity for that
 * long. The proxy refuses such a token on every request; the jwt
 * callback refuses it too when something asks to refresh it, so an
 * update() call cannot bring an idle session back to life.
 */
export function tokenIsIdle(
  token: SessionClaims & { lastActivity?: unknown },
  nowMs: number = Date.now(),
): boolean {
  const last =
    typeof token.lastActivity === 'number'
      ? token.lastActivity
      : (signedInAt(token) ?? 0) * 1000
  return nowMs - last > IDLE_TIMEOUT_MS
}
