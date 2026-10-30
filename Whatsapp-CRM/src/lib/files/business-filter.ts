import type { Prisma } from '@prisma/client'

/**
 * Which accounts are businesses, for the legacy-file rule
 * (src/lib/files/legacy-access.ts) and its backfill script
 * (scripts/backfill-legacy-file-owner.ts), so the two can never disagree.
 *
 * A business is an account with at least one member who can sign in.
 * Not a business: a holding account (deactivateMember leaves a removed
 * member there with no password) or an empty personal account left behind
 * by somebody who self-registered and then redeemed an invitation.
 * Sign-in is credentials-only, so "can sign in" is "has a password".
 *
 * No imports beyond types: the script loads this outside Next.
 */
export const BUSINESS_ACCOUNT_WHERE = {
  profiles: { some: { user: { password_hash: { not: null } } } },
} satisfies Prisma.AccountWhereInput
