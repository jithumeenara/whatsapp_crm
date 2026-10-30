/**
 * Using up an invitation — the one place it happens.
 *
 * An invitation is a one-time pass into one account, at one role. Two
 * things used to let it be more than that:
 *
 *  - It was checked, and then later marked used. Two requests arriving
 *    together both passed the check, and both got in.
 *  - Sign-up only checked it was live and never used it up at all, so
 *    the same link let anybody who saw it create a workspace of their own.
 *
 * Claiming is now a single conditional UPDATE — unused, unexpired, this
 * token — and whoever's UPDATE changed the row is the one who got it.
 * Postgres serialises the two writes, so the second finds nothing left
 * to change. Call it inside the same transaction as whatever the
 * invitation pays for (the new login, the move into the account), so a
 * failure there hands the invitation back.
 *
 * The account and the role come from the invitation row and nowhere
 * else: nothing a request body says can change them.
 *
 * An invitation that names an email (migration 152) can only be claimed
 * by a login with that address, compared trimmed and lowercased — the
 * match is part of the same conditional UPDATE. One made without an
 * address (older links) is claimable by whoever holds it, as before, and
 * the server log records that it happened.
 */
import type { Prisma } from '@prisma/client'
import { hashInviteToken } from './invitations'

type Tx = Pick<Prisma.TransactionClient, 'accountInvitation'>

export interface ClaimedInvitation {
  id: string
  account_id: string
  role: 'owner' | 'admin' | 'supervisor' | 'agent' | 'viewer'
}

/** Trimmed and lowercased — how invitation emails are stored and compared. */
export function normaliseInviteEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const e = email.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null
}

export function plausibleInviteToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 16 && token.length <= 200
}

export async function claimInvitation(
  tx: Tx,
  token: unknown,
  userId: string,
  email: string,
  now: Date = new Date(),
): Promise<ClaimedInvitation> {
  if (!plausibleInviteToken(token)) throw new InvitationUnavailableError()
  const tokenHash = hashInviteToken(token)
  const claimant = email.trim().toLowerCase()

  const { count } = await tx.accountInvitation.updateMany({
    where: {
      token_hash: tokenHash,
      accepted_at: null,
      expires_at: { gt: now },
      OR: [{ email: null }, { email: claimant }],
    },
    data: { accepted_at: now, accepted_by_user_id: userId },
  })

  const row = await tx.accountInvitation.findFirst({
    where: { token_hash: tokenHash },
    select: { id: true, account_id: true, role: true, email: true, accepted_at: true, expires_at: true },
  })
  if (count !== 1) {
    // Say why, when it is the address: the link is live but for somebody else.
    if (row && row.accepted_at === null && row.expires_at > now && row.email && row.email !== claimant) {
      throw new InvitationUnavailableError('wrong_email')
    }
    throw new InvitationUnavailableError()
  }
  // Never hand out an owner seat through a link, whatever a row says —
  // ownership moves only through transfer-ownership. Throwing rolls the
  // claim back with the caller's transaction.
  if (!row || row.role === 'owner') throw new InvitationUnavailableError()
  if (!row.email) {
    console.warn('[invitation] an invitation with no email bound was used', { invitationId: row.id, userId })
  }
  return { id: row.id, account_id: row.account_id, role: row.role as ClaimedInvitation['role'] }
}

/** Thrown inside a transaction to undo it when the invitation could not
 *  be claimed — the caller turns it into a plain refusal. */
export class InvitationUnavailableError extends Error {
  readonly reason: 'unavailable' | 'wrong_email'
  constructor(reason: 'unavailable' | 'wrong_email' = 'unavailable') {
    super(
      reason === 'wrong_email'
        ? 'This invitation was sent to a different email address. Sign in or sign up with the address it was sent to.'
        : 'This invitation has already been used or has expired.',
    )
    this.name = 'InvitationUnavailableError'
    this.reason = reason
  }
}
