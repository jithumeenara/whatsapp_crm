import { audit, auditCtx, type AuditEntry } from '@/lib/audit'
import { requireRole } from '@/lib/auth/account'

/**
 * Records an audit event from a Flows / chatbot route whose guard
 * (denyUnlessFlowEditor / denyUnlessRole) checks the caller but does not
 * hand back who they are. requireRole reads the cached profile, so this
 * costs no extra query on a request that already passed the guard.
 * Never throws: a missing context only means the event is skipped.
 */
export async function auditFlowAction(req: Request | null, entry: AuditEntry, correlationId?: string): Promise<void> {
  let ctx: Awaited<ReturnType<typeof requireRole>>
  try {
    ctx = await requireRole('viewer')
  } catch {
    return
  }
  await audit({ ...auditCtx(req, ctx), ...(correlationId ? { correlationId } : {}) }, entry)
}
