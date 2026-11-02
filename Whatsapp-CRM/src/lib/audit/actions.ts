/**
 * Every audit action this app may record, with its category. Names are
 * `resource.verb` (GitHub/Stripe style); an unknown name is a type error,
 * and at runtime it is refused rather than stored under a typo.
 * See docs/plans/audit-log-plan.md §4.
 */

export const AUDIT_CATEGORIES = ['auth', 'access', 'admin', 'config', 'data', 'export', 'agent', 'system'] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

const A = {
  // ── auth ────────────────────────────────────────────────────────────
  'auth.login_success': 'auth',
  'auth.login_fail': 'auth',
  'auth.logout': 'auth',
  'auth.new_device': 'auth',
  'auth.mfa_fail': 'auth',
  'auth.mfa_enabled': 'auth',
  'auth.mfa_disabled': 'auth',
  'auth.mfa_reset_by_admin': 'auth',
  'auth.password_changed': 'auth',
  'auth.password_reset_by_admin': 'auth',
  'auth.session_revoked': 'auth',
  'auth.signed_out_everywhere': 'auth',
  'auth.registered': 'auth',
  'auth.email_verified': 'auth',
  'auth.rate_limited': 'auth',
  // ── access ──────────────────────────────────────────────────────────
  'access.denied': 'access',
  'access.audit_viewed': 'access',
  'access.audit_exported': 'access',
  'access.audit_verified': 'access',
  'access.socket_refused': 'access',
  'access.file_viewed': 'access',
  'access.sensitive_viewed': 'access',
  'access.api_key_used': 'access',
  // ── admin ───────────────────────────────────────────────────────────
  'member.invited': 'admin',
  'member.invite_cancelled': 'admin',
  'member.joined': 'admin',
  'member.created': 'admin',
  'member.updated': 'admin',
  'member.role_changed': 'admin',
  'member.pages_changed': 'admin',
  'member.deactivated': 'admin',
  'member.revived': 'admin',
  'account.ownership_transferred': 'admin',
  'account.updated': 'admin',
  'api_key.created': 'admin',
  'api_key.revoked': 'admin',
  'database.backup_downloaded': 'admin',
  'admin_chat.session_started': 'admin',
  'admin_chat.session_ended': 'admin',
  // ── config ──────────────────────────────────────────────────────────
  'config.whatsapp_changed': 'config',
  'config.ai_changed': 'config',
  'config.integration_changed': 'config',
  'config.webhook_changed': 'config',
  'config.payment_changed': 'config',
  'config.channel_changed': 'config',
  'config.security_changed': 'config',
  'config.platform_changed': 'config',
  'config.google_changed': 'config',
  'config.lead_settings_changed': 'config',
  'config.other_changed': 'config',
  // ── data ────────────────────────────────────────────────────────────
  'record.created': 'data',
  'record.updated': 'data',
  'record.deleted': 'data',
  'record.archived': 'data',
  'record.restored': 'data',
  'record.merged': 'data',
  'record.status_changed': 'data',
  'record.assigned': 'data',
  'record.bulk_updated': 'data',
  'record.bulk_deleted': 'data',
  'import.completed': 'data',
  'file.uploaded': 'data',
  'file.deleted': 'data',
  'payment.link_created': 'data',
  'payment.paid': 'data',
  'payment.refunded': 'data',
  'broadcast.sent': 'data',
  'broadcast.retried': 'data',
  'broadcast.cancelled': 'data',
  'message.sent': 'data',
  'message.deleted': 'data',
  'public.form_submitted': 'data',
  'public.details_confirmed': 'data',
  // ── export ──────────────────────────────────────────────────────────
  'export.downloaded': 'export',
  // ── agent ───────────────────────────────────────────────────────────
  'agent.record_written': 'agent',
  'agent.tool_called': 'agent',
  'agent.action_confirmed': 'agent',
  'agent.action_rejected': 'agent',
  'agent.handover': 'agent',
  // ── system ──────────────────────────────────────────────────────────
  'system.boot': 'system',
  'system.job_failed': 'system',
  'system.job_wrote': 'system',
  'system.webhook_received': 'system',
  'system.webhook_rejected': 'system',
  'system.audit_write_failed': 'system',
  'system.chain_broken': 'system',
  'system.default_partition_used': 'system',
  'system.backup_completed': 'system',
  'system.backup_failed': 'system',
  'system.deployed': 'system',
} as const satisfies Record<string, AuditCategory>

export type AuditAction = keyof typeof A

export function categoryOf(action: string): AuditCategory | null {
  return (A as Record<string, AuditCategory>)[action] ?? null
}

export const AUDIT_ACTIONS = Object.keys(A) as AuditAction[]
