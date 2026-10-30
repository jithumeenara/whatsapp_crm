import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/db'
import { hasMinRole, isAccountRole } from './roles'

/** The rank every key acts at (requireRoleOrApiKey). Its creator must
 *  still hold at least this much for the key to keep working. */
export const API_KEY_ROLE = 'supervisor' as const

/** Longest life a key may be given when it is minted. */
export const MAX_API_KEY_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

const PREFIX = 'wcrm_'

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const secret = randomBytes(32).toString('hex') // 64 hex chars
  const raw = `${PREFIX}${secret}`               // 69 chars total
  const hash = createHash('sha256').update(raw).digest('hex')
  const prefix = raw.slice(0, 12)               // "wcrm_" + 7 chars — shown in UI
  return { raw, hash, prefix }
}

/**
 * Verify a raw API key from the Authorization header.
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns null for any invalid / unknown key.
 *
 * Checked on EVERY request, never cached, so each of these takes effect
 * on the key's very next call:
 *   - revoked (revoked_at) or deleted;
 *   - past its expires_at;
 *   - its creator is no longer a member of the key's account, or holds
 *     less than the key's own supervisor rank. Removing or demoting the
 *     person who minted a key ends it; no key outranks its creator.
 * A key with no recorded creator was minted before migration 152 and is
 * the account owner's; it keeps working.
 */
export async function verifyApiKey(
  raw: string,
): Promise<{ accountId: string; keyId: string; creatorUserId: string | null } | null> {
  if (!raw.startsWith(PREFIX) || raw.length < 20) return null

  const hash = createHash('sha256').update(raw).digest('hex')
  const hashBuf = Buffer.from(hash, 'hex')

  // Narrow the search by prefix (avoids full-table scan on large accounts)
  const prefix = raw.slice(0, 12)
  const now = new Date()
  const candidates = await prisma.apiKey.findMany({
    where: {
      key_prefix: prefix,
      revoked_at: null,
      OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    },
    select: { id: true, account_id: true, key_hash: true, created_by_user_id: true },
  })

  for (const candidate of candidates) {
    const storedBuf = Buffer.from(candidate.key_hash, 'hex')
    // Lengths must match for timingSafeEqual; both are SHA-256 hex so always 32 bytes
    if (storedBuf.length !== hashBuf.length) continue
    if (timingSafeEqual(storedBuf, hashBuf)) {
      if (candidate.created_by_user_id && !(await creatorStillEntitled(candidate.created_by_user_id, candidate.account_id))) {
        return null
      }
      // Update last_used_at without blocking the response
      prisma.apiKey
        .update({ where: { id: candidate.id }, data: { last_used_at: new Date() } })
        .catch(() => {})
      return { accountId: candidate.account_id, keyId: candidate.id, creatorUserId: candidate.created_by_user_id }
    }
  }
  return null
}

async function creatorStillEntitled(userId: string, accountId: string): Promise<boolean> {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true, account_role: true },
  })
  if (!profile || profile.account_id !== accountId) return false
  return isAccountRole(profile.account_role) && hasMinRole(profile.account_role, API_KEY_ROLE)
}
