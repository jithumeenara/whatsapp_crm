/**
 * Who may create an account on this server.
 *
 * Each client runs this app on its own server, for its own team. On such
 * a server "Create account" was an open door: anybody who found the login
 * page could make themselves the owner of a fresh, empty workspace on the
 * client's machine — using its disk, its database and, once they found a
 * way in, its attention. Team members join by invitation; nobody else
 * needs to sign up at all.
 *
 * So sign-up is closed unless the server says otherwise, and the only
 * way through a closed door is a live invitation. A future multi-tenant
 * server, where strangers are meant to sign up, opens it with
 * NEXT_PUBLIC_ALLOW_SIGNUP=true in its .env (it is read in the browser
 * too, to show the link, so it carries the NEXT_PUBLIC_ prefix; changing
 * it needs a rebuild).
 */

import { prisma } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invitations'

export function publicSignupOpen(): boolean {
  return process.env.NEXT_PUBLIC_ALLOW_SIGNUP === 'true'
}

/** True for an invitation that exists, has not been used and has not
 *  expired. The token is hashed before the database sees it, the same way
 *  /api/invitations/[token]/peek does. */
export async function isLiveInvitation(token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) return false
  const invitation = await prisma.accountInvitation.findFirst({
    where: { token_hash: hashInviteToken(token), accepted_at: null, expires_at: { gt: new Date() } },
    select: { id: true },
  })
  return invitation !== null
}
