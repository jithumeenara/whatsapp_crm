/**
 * The person who owns this server — not merely the owner of a workspace.
 *
 * "Owner" is a workspace role, and a server can hold several workspaces:
 * every holding account a removed member is parked in, and every sign-up
 * on a server that allows them. Anything that reaches the whole database
 * (the backup download) is for the server's owner alone:
 *
 *   - PLATFORM_ADMIN_EMAILS in the server's .env (comma separated), or,
 *     when that is not set,
 *   - the owner of the first workspace created on this server.
 */

import { prisma } from '@/lib/db'

export async function isPlatformOwner(userId: string): Promise<boolean> {
  const listed = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (listed.length > 0) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, password_hash: true } })
    return Boolean(user?.password_hash && listed.includes(user.email.trim().toLowerCase()))
  }
  const first = await prisma.account.findFirst({ orderBy: { created_at: 'asc' }, select: { owner_user_id: true } })
  return first?.owner_user_id === userId
}
