/**
 * The team member whose Agent report card a supervisor asked for — only
 * when that person belongs to the same business. An id from the address
 * is never trusted on its own (AGENTS.md: every record loaded with the
 * account id).
 */

import { prisma } from '@/lib/db'
import { cleanPersonName } from '@/lib/auth/person-name'
import { MEMBER_ID } from './registry'


export async function findMember(accountId: string, userId: string): Promise<{ userId: string; name: string } | null> {
  if (!MEMBER_ID.test(userId)) return null
  const p = await prisma.profile.findFirst({
    where: { account_id: accountId, user_id: userId },
    select: { user_id: true, full_name: true },
  })
  return p ? { userId: p.user_id, name: cleanPersonName(p.full_name) || 'Team member' } : null
}
