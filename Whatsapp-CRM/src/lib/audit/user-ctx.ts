/**
 * An audit context for routes that know only the signed-in user's id
 * (auth() rather than requireRole): their team and role are read here.
 * Never throws — a failed lookup gives an event on the platform chain
 * rather than no event at all.
 */

import { prisma } from '@/lib/db'
import { auditCtx } from './context'
import type { AuditContext } from './write'

interface HeaderLike { get(name: string): string | null }

export async function userAuditCtx(req: Request | HeaderLike | null, userId: string): Promise<AuditContext> {
  let accountId: string | null = null
  let role = 'viewer'
  try {
    const p = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true, account_role: true } })
    accountId = p?.account_id ?? null
    role = p?.account_role ?? role
  } catch {
    /* recorded without a team */
  }
  const ctx = auditCtx(req, { accountId: accountId ?? '', userId, role })
  return { ...ctx, accountId }
}
