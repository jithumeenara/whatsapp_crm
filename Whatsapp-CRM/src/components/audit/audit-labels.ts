/**
 * Plain words for the audit log screen. Display only: the server decides
 * what exists; an action missing here falls back to a readable form of its
 * own name, never to nothing.
 */

export interface AuditEventView {
  id: string
  seq: string
  occurred_at: string
  actor_type: string
  actor_id: string | null
  actor_label: string | null
  actor_name: string | null
  actor_role: string | null
  on_behalf_of: string | null
  on_behalf_of_name: string | null
  action: string
  category: string
  outcome: string
  reason: string | null
  target_type: string | null
  target_id: string | null
  target_label: string | null
  changes: unknown
  request_id: string | null
  correlation_id: string | null
  source: string
  ip: string | null
  user_agent: string | null
  meta: unknown
  row_hash: string
}

export const ACTION_PHRASES: Record<string, string> = {
  'auth.login_success': 'signed in',
  'auth.login_fail': 'failed to sign in',
  'auth.logout': 'signed out',
  'auth.new_device': 'signed in from a new device',
  'auth.mfa_fail': 'entered a wrong sign-in code',
  'auth.mfa_enabled': 'turned on two-step sign-in',
  'auth.mfa_disabled': 'turned off two-step sign-in',
  'auth.mfa_reset_by_admin': 'reset two-step sign-in for a member',
  'auth.password_changed': 'changed their password',
  'auth.password_reset_by_admin': 'reset the password of a member',
  'auth.session_revoked': 'signed out a session',
  'auth.signed_out_everywhere': 'signed out everywhere',
  'auth.registered': 'created an account',
  'auth.email_verified': 'verified their email',
  'auth.rate_limited': 'was slowed down for too many tries',
  'access.denied': 'was refused access',
  'access.audit_viewed': 'opened the audit log',
  'access.audit_exported': 'exported the audit log',
  'access.audit_verified': 'checked the audit log',
  'access.socket_refused': 'was refused a live connection',
  'access.file_viewed': 'opened a file',
  'access.sensitive_viewed': 'opened a sensitive record',
  'access.api_key_used': 'used an API key',
  'member.invited': 'invited a member',
  'member.invite_cancelled': 'cancelled an invitation',
  'member.joined': 'joined the team',
  'member.created': 'added a member',
  'member.updated': 'changed a member',
  'member.role_changed': 'changed the role of a member',
  'member.pages_changed': 'changed the pages a member can open',
  'member.deactivated': 'switched off a member',
  'member.revived': 'switched a member back on',
  'account.ownership_transferred': 'handed over ownership',
  'account.updated': 'changed the account',
  'api_key.created': 'created an API key',
  'api_key.revoked': 'revoked an API key',
  'database.backup_downloaded': 'downloaded a database backup',
  'admin_chat.session_started': 'started an admin chat session',
  'admin_chat.session_ended': 'ended an admin chat session',
  'config.whatsapp_changed': 'changed WhatsApp settings',
  'config.ai_changed': 'changed AI settings',
  'config.integration_changed': 'changed an integration',
  'config.webhook_changed': 'changed a webhook',
  'config.payment_changed': 'changed payment settings',
  'config.channel_changed': 'changed a channel',
  'config.security_changed': 'changed security settings',
  'config.platform_changed': 'changed platform settings',
  'config.google_changed': 'changed Google settings',
  'config.lead_settings_changed': 'changed lead settings',
  'config.other_changed': 'changed settings',
  'record.created': 'created',
  'record.updated': 'changed',
  'record.deleted': 'deleted',
  'record.archived': 'archived',
  'record.restored': 'restored',
  'record.merged': 'merged',
  'record.status_changed': 'changed the status of',
  'record.assigned': 'assigned',
  'record.bulk_updated': 'changed several',
  'record.bulk_deleted': 'deleted several',
  'import.completed': 'finished an import',
  'file.uploaded': 'uploaded a file',
  'file.deleted': 'deleted a file',
  'payment.link_created': 'created a payment link',
  'payment.paid': 'recorded a payment',
  'payment.refunded': 'refunded a payment',
  'broadcast.sent': 'sent a broadcast',
  'broadcast.retried': 'retried a broadcast',
  'broadcast.cancelled': 'cancelled a broadcast',
  'message.sent': 'sent a message',
  'message.deleted': 'deleted a message',
  'public.form_submitted': 'submitted a public form',
  'public.details_confirmed': 'confirmed their details',
  'export.downloaded': 'downloaded an export',
  'agent.record_written': 'saved a record',
  'agent.tool_called': 'used a tool',
  'agent.action_confirmed': 'had an action confirmed',
  'agent.action_rejected': 'had an action turned down',
  'agent.handover': 'handed over to a person',
  'system.boot': 'started the server',
  'system.job_failed': 'had a background job fail',
  'system.job_wrote': 'changed data in a background job',
  'system.webhook_received': 'received a webhook',
  'system.webhook_rejected': 'refused a webhook with a bad signature',
  'system.audit_write_failed': 'could not write audit events in time',
  'system.chain_broken': 'found a break in the audit log',
  'system.default_partition_used': 'stored events in the spare partition',
  'system.backup_completed': 'finished a backup',
  'system.backup_failed': 'failed a backup',
  'system.deployed': 'deployed a new version',
}

/** Actions whose phrase needs the record's type after it ("deleted a lead"). */
const NEEDS_RECORD = /^record\./

export function actionPhrase(e: Pick<AuditEventView, 'action' | 'target_type'>): string {
  const base = ACTION_PHRASES[e.action] ?? e.action.replace(/[._]/g, ' ')
  if (NEEDS_RECORD.test(e.action)) {
    const t = recordTypeLabel(e.target_type)
    const plural = e.action.startsWith('record.bulk_')
    return `${base} ${plural ? `${t}s` : `a ${t}`}`
  }
  return base
}

export function recordTypeLabel(t: string | null | undefined): string {
  if (!t) return 'record'
  return t.replace(/_/g, ' ')
}

export const ACTOR_TYPES: Record<string, string> = {
  user: 'Person',
  agent: 'AI agent',
  api_key: 'API key',
  system: 'System',
  webhook: 'Webhook',
  public: 'Public',
}

export const ACTOR_BADGE: Record<string, string> = {
  user: 'bg-slate-100 text-slate-700',
  agent: 'bg-indigo-50 text-indigo-700',
  api_key: 'bg-amber-50 text-amber-800',
  system: 'bg-slate-100 text-slate-600',
  webhook: 'bg-sky-50 text-sky-700',
  public: 'bg-emerald-50 text-emerald-700',
}

export const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Sign-in',
  access: 'Access',
  admin: 'Team',
  config: 'Settings',
  data: 'Records',
  export: 'Exports',
  agent: 'AI agents',
  system: 'System',
}

export const OUTCOME_LABELS: Record<string, string> = {
  success: 'Done',
  denied: 'Refused',
  failure: 'Failed',
}

export const OUTCOME_BADGE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  denied: 'bg-amber-50 text-amber-800',
  failure: 'bg-rose-50 text-rose-700',
}

export const SOURCE_LABELS: Record<string, string> = {
  web: 'Web app',
  api: 'API',
  mcp: 'MCP',
  job: 'Background job',
  webhook: 'Webhook',
  ai: 'AI',
  admin_chat: 'Admin chat',
  public: 'Public link',
  system: 'Server',
}

export function actorName(e: AuditEventView): string {
  if (e.actor_type === 'user') return e.actor_name || e.actor_label || 'A removed member'
  if (e.actor_type === 'agent') return e.actor_label || (e.actor_id ? e.actor_id.replace(/_/g, ' ') : 'AI agent')
  return e.actor_label || e.actor_id?.replace(/_/g, ' ') || ACTOR_TYPES[e.actor_type] || e.actor_type
}

export function targetText(e: AuditEventView): string | null {
  if (!e.target_type && !e.target_label && !e.target_id) return null
  const type = recordTypeLabel(e.target_type)
  if (e.target_label) return `${e.target_label} (${type})`
  return e.target_id ? `${type} ${e.target_id}` : type
}
