/**
 * Backs "Sign out everywhere" — bulk revocation across every device at
 * once, independent of the per-device UserSession rows (Settings >
 * Profile > Sessions can revoke one row individually; this instead sets
 * one timestamp that covers all of them). src/auth.ts's jwt callback
 * checks every token's issued-at time against it on every request and
 * rejects anything issued earlier, which is what actually forces a
 * re-login on every device (including the one that clicked the button) —
 * invalidateAllSessions() also marks every UserSession row revoked so the
 * Sessions list reflects it immediately rather than showing stale rows
 * until each one is naturally checked and rejected.
 *
 * Cached briefly (same shape as the profile cache in lib/auth/account.ts)
 * so this doesn't cost a DB round-trip on every single authenticated
 * request — 30s is short enough that a fresh sign-out-everywhere still
 * takes effect almost immediately.
 */
import { prisma } from "@/lib/db"

const CACHE_TTL_MS = 30_000

interface CacheEntry {
  value: Date | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export async function getSessionInvalidatedAt(userId: string): Promise<Date | null> {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { session_invalidated_at: true } })
  const value = user?.session_invalidated_at ?? null
  cache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

export async function invalidateAllSessions(userId: string): Promise<void> {
  const now = new Date()
  await Promise.all([
    prisma.user.update({ where: { id: userId }, data: { session_invalidated_at: now } }),
    prisma.userSession.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: now },
    }),
  ])
  cache.set(userId, { value: now, expiresAt: Date.now() + CACHE_TTL_MS })
}
