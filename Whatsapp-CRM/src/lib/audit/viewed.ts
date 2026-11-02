/**
 * "Who looked at the audit log": one access.audit_viewed event per admin
 * per business day (plan §6 — no self-hiding). Best effort: a failure to
 * record a view never stops the view.
 */

import { prisma } from '@/lib/db'
import { businessTimezone } from '@/lib/ai/human-date'
import type { AccountContext } from '@/lib/auth/account'
import { audit } from './write'
import { auditCtx } from './context'
import { dayKey, dayStartIso } from './zoned'

export async function recordAuditViewOncePerDay(
  req: Request,
  ctx: Pick<AccountContext, 'accountId' | 'userId' | 'role'>,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const tz = await businessTimezone(ctx.accountId)
    const start = dayStartIso(dayKey(new Date(), tz), tz)
    if (!start) return
    const seen = await prisma.auditEvent.findFirst({
      where: {
        account_id: ctx.accountId,
        action: 'access.audit_viewed',
        actor_type: 'user',
        actor_id: ctx.userId,
        occurred_at: { gte: new Date(start) },
      },
      select: { id: true },
    })
    if (seen) return
    await audit(auditCtx(req, ctx), { action: 'access.audit_viewed', target: { type: 'audit_log' }, meta })
  } catch (err) {
    console.error('[audit] could not record a view:', err instanceof Error ? err.message : err)
  }
}
