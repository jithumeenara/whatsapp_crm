/**
 * Audit log — the one import for the rest of the app.
 *
 *   import { audit, auditCtx } from '@/lib/audit'
 *   await audit(auditCtx(req, ctx), { action: 'record.updated', target: { type: 'lead', id }, before, after })
 *
 * Never put secrets, tokens, passwords, OTPs, message bodies or full ID
 * numbers in an event: the sanitizer masks what it recognises, but the
 * caller chooses what to pass. See docs/plans/audit-log-plan.md.
 */

export { audit, auditInTx, auditEnabled, PLATFORM_ACCOUNT, type AuditActor, type AuditContext, type AuditEntry, type AuditSource } from './write'
export { auditCtx, systemCtx, webhookCtx, agentCtx, publicCtx } from './context'
export { changedFieldNames, diff, maskText } from './sanitize'
export type { AuditAction, AuditCategory } from './actions'
