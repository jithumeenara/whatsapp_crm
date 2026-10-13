/**
 * Removing a team member switches them off. It never deletes them.
 *
 * Two things went wrong with the old ways:
 *
 *  - Agents were hard-deleted, and the database cascades a deleted user
 *    into everything they created: contacts (and with them every
 *    conversation and message), leads, follow-ups, tasks, deals. Removing
 *    an agent quietly removed their work.
 *  - Everyone else was moved into a fresh personal account as its OWNER,
 *    still able to sign in — and an owner reaches Settings → Database.
 *    A removed employee could take the business's data.
 *
 * Now: the person can no longer sign in (no password, every session
 * ended), sits as a viewer in an empty holding account that is theirs
 * alone, and every row they created stays where it was, in the team's
 * account, readable as before. Adding the same agent number again turns
 * them back on (reviveMember), history intact.
 */

import { prisma } from '@/lib/db'
import { invalidateAllSessions } from './session-invalidation'

export async function deactivateMember(userId: string, displayName: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const holding = await tx.account.create({
      data: { name: `${displayName?.trim() || 'Former member'} (removed)`, owner_user_id: userId },
    })
    await tx.profile.update({ where: { user_id: userId }, data: { account_id: holding.id, account_role: 'viewer' } })
    await tx.user.update({
      where: { id: userId },
      data: { password_hash: null, totp_secret: null, mfa_method: 'disabled', mfa_phone: null },
    })
  })
  await invalidateAllSessions(userId)
}

/**
 * Whether a user is a switched-off member: no password, alone in a
 * holding account of their own. Only such a user may be taken back into
 * an account — never somebody who works in another workspace.
 */
export async function isDeactivatedMember(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password_hash: true, profile: { select: { account_id: true } }, owned_accounts: { select: { id: true } } },
  })
  if (!user || user.password_hash || !user.profile) return false
  const home = user.profile.account_id
  if (!user.owned_accounts.some((a) => a.id === home)) return false
  const others = await prisma.profile.count({ where: { account_id: home, user_id: { not: userId } } })
  return others === 0
}

/** Back into an account with a new password. The empty holding account goes. */
export async function reviveMember(args: {
  userId: string
  accountId: string
  role: 'admin' | 'supervisor' | 'agent' | 'viewer'
  fullName: string
  passwordHash: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { user_id: args.userId }, select: { account_id: true } })
    await tx.profile.update({
      where: { user_id: args.userId },
      data: { account_id: args.accountId, account_role: args.role, full_name: args.fullName },
    })
    await tx.user.update({ where: { id: args.userId }, data: { password_hash: args.passwordHash, session_invalidated_at: new Date() } })
    // The holding account held nothing but this person.
    if (profile && profile.account_id !== args.accountId) {
      await tx.account.deleteMany({ where: { id: profile.account_id, owner_user_id: args.userId } })
    }
  })
}
