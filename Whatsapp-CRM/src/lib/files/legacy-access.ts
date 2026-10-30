import { prisma } from "@/lib/db"
import { publicSignupOpen } from "@/lib/auth/signup-policy"
import { BUSINESS_ACCOUNT_WHERE } from "./business-filter"

/**
 * Files uploaded before per-account folders (`uploads/<name>`, not
 * `uploads/account-<id>/<name>`) have no folder that says whose they are.
 *
 * - Where the upload was recorded (file_uploads.url), that account decides.
 * - Where it was not, nobody can tell whose it is. On a server that has only
 *   ever had one business, it can only be that business's, so it is still
 *   served. Once a second business exists the same file could be anyone's,
 *   so it is refused (security review N4 / A3-23, decided by the owner).
 *
 * "Business" is not "Account row" (round 5, R4b). A single-business server
 * also holds:
 *  - holding accounts: deactivateMember parks a removed member, with no
 *    password, alone in one of their own;
 *  - empty personal accounts: whoever self-registered before sign-up was
 *    closed got one, and left it behind when they redeemed an invite.
 * Neither can sign anybody in, so neither is a business. A business is an
 * account with at least one member who can sign in (a password: login is
 * credentials-only, and deactivateMember is the one path that clears it).
 * Structural, not a name pattern: "(removed)" is just a display name.
 *
 * With public sign-up open (NEXT_PUBLIC_ALLOW_SIGNUP) any stranger can make
 * the second business at any moment, so such a server is treated as
 * multi-business from the start.
 *
 * Used by GET /api/files and by every send path (media-ref.ts), so the two
 * can never disagree about who may use a file.
 */

// Short, because only this process's own changes drop it at once
// (invalidateBusinessCount); another process's are seen within this.
const COUNT_TTL_MS = 10_000
let cachedCount: { value: number; at: number } | null = null

/**
 * Forget the cached business count. Call after anything that creates an
 * account or changes which account a member is in, or whether they can
 * sign in: sign-up, invitation redemption, adding a member,
 * deactivateMember / reviveMember, ownership transfer (security review R4a).
 */
export function invalidateBusinessCount(): void {
  cachedCount = null
}

/** Old name, kept for the tests that use it. */
export const forgetAccountCount = invalidateBusinessCount

async function businessCount(): Promise<number> {
  const now = Date.now()
  if (cachedCount && now - cachedCount.at < COUNT_TTL_MS) return cachedCount.value
  // Two is enough to know "more than one"; no need to count every row.
  const rows = await prisma.account.findMany({
    where: BUSINESS_ACCOUNT_WHERE,
    select: { id: true },
    take: 2,
  })
  cachedCount = { value: rows.length, at: now }
  return rows.length
}

/** True when `accountId` may use the legacy root-level file behind `url` (`/api/files/<name>`). */
export async function legacyFileAllowed(url: string, accountId: string): Promise<boolean> {
  if (!accountId) return false
  try {
    const owner = await prisma.fileUpload.findFirst({ where: { url }, select: { account_id: true } })
    if (owner) return owner.account_id === accountId
    if (publicSignupOpen()) return false
    return (await businessCount()) === 1
  } catch (err) {
    // Fail closed: an unknown owner is not this caller's.
    console.error("[files] legacy ownership check failed:", err)
    return false
  }
}
