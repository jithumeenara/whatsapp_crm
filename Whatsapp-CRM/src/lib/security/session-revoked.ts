import { prisma } from '@/lib/db'
import { tokenIsStale, type SessionClaims } from '@/lib/auth/session-guard'
import { getSessionInvalidatedAt } from '@/lib/auth/session-invalidation'

/**
 * For routes that read the session with getToken() — which only decrypts
 * the cookie and runs none of auth.ts's checks — and then act on it:
 * the heartbeat (which re-signs it) and the departure beacon.
 *
 * The same refusals auth.ts's jwt callback makes: signed in before "sign
 * out everywhere" or more than eight hours ago (judged from authTime,
 * the sign-in, never from iat, which every re-sign moves — see
 * src/lib/auth/session-guard.ts), or this device logged out from
 * Settings → Sessions. A lookup that fails is not a revocation, as in
 * auth.ts: a database blip must not sign everybody out.
 */
export async function sessionRevoked(
  token: SessionClaims & { id?: unknown; sessionId?: unknown },
): Promise<boolean> {
  try {
    const invalidatedAt = await getSessionInvalidatedAt(String(token.id))
    if (tokenIsStale(token, invalidatedAt)) return true
    if (typeof token.sessionId === 'string' && token.sessionId) {
      const row = await prisma.userSession.findUnique({
        where: { id: token.sessionId },
        select: { revoked_at: true },
      })
      if (row?.revoked_at) return true
    }
  } catch (err) {
    console.error('[session] revocation check failed:', err)
  }
  return false
}
