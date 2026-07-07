import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/db'

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
 */
export async function verifyApiKey(
  raw: string,
): Promise<{ accountId: string; keyId: string } | null> {
  if (!raw.startsWith(PREFIX) || raw.length < 20) return null

  const hash = createHash('sha256').update(raw).digest('hex')
  const hashBuf = Buffer.from(hash, 'hex')

  // Narrow the search by prefix (avoids full-table scan on large accounts)
  const prefix = raw.slice(0, 12)
  const candidates = await prisma.apiKey.findMany({
    where: { key_prefix: prefix },
    select: { id: true, account_id: true, key_hash: true },
  })

  for (const candidate of candidates) {
    const storedBuf = Buffer.from(candidate.key_hash, 'hex')
    // Lengths must match for timingSafeEqual; both are SHA-256 hex so always 32 bytes
    if (storedBuf.length !== hashBuf.length) continue
    if (timingSafeEqual(storedBuf, hashBuf)) {
      // Update last_used_at without blocking the response
      prisma.apiKey
        .update({ where: { id: candidate.id }, data: { last_used_at: new Date() } })
        .catch(() => {})
      return { accountId: candidate.account_id, keyId: candidate.id }
    }
  }
  return null
}
