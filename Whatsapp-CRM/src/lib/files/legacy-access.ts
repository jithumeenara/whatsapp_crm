import { prisma } from "@/lib/db"

/**
 * Files uploaded before per-account folders (`uploads/<name>`, not
 * `uploads/account-<id>/<name>`) have no folder that says whose they are.
 *
 * - Where the upload was recorded (file_uploads.url), that account decides.
 * - Where it was not, nobody can tell whose it is. On a server that has only
 *   ever had one business, it can only be that business's, so it is still
 *   served. Once a second account exists the same file could be anyone's, so
 *   it is refused (security review N4 / A3-23, decided by the owner).
 *
 * Used by GET /api/files and by every send path (media-ref.ts), so the two
 * can never disagree about who may use a file.
 */

const COUNT_TTL_MS = 60_000
let cachedCount: { value: number; at: number } | null = null

/** For tests. */
export function forgetAccountCount(): void {
  cachedCount = null
}

async function accountCount(): Promise<number> {
  const now = Date.now()
  if (cachedCount && now - cachedCount.at < COUNT_TTL_MS) return cachedCount.value
  // Two is enough to know "more than one"; no need to count every row.
  const rows = await prisma.account.findMany({ select: { id: true }, take: 2 })
  cachedCount = { value: rows.length, at: now }
  return rows.length
}

/** True when `accountId` may use the legacy root-level file behind `url` (`/api/files/<name>`). */
export async function legacyFileAllowed(url: string, accountId: string): Promise<boolean> {
  if (!accountId) return false
  try {
    const owner = await prisma.fileUpload.findFirst({ where: { url }, select: { account_id: true } })
    if (owner) return owner.account_id === accountId
    return (await accountCount()) === 1
  } catch (err) {
    // Fail closed: an unknown owner is not this caller's.
    console.error("[files] legacy ownership check failed:", err)
    return false
  }
}
