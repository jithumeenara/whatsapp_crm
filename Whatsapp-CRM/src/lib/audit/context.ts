/**
 * Building the "who / from where" of an audit event from what a route
 * already has: the auth context from requireRole / requireRoleOrApiKey and
 * the request headers. No database reads — names are joined at read time.
 */

import { clientIp } from '@/lib/net/client-ip'
import type { AuditContext, AuditSource } from './write'

interface HeaderLike { get(name: string): string | null }

interface AuthLike {
  accountId: string
  userId: string
  role: string
  apiKeyId?: string
}

function headersOf(req: Request | HeaderLike | null | undefined): HeaderLike | null {
  if (!req) return null
  return 'headers' in (req as Request) ? (req as Request).headers : (req as HeaderLike)
}

/** The context for an action by a signed-in person or an API key. */
export function auditCtx(req: Request | HeaderLike | null | undefined, auth: AuthLike, source?: AuditSource): AuditContext {
  const h = headersOf(req)
  const isKey = !!auth.apiKeyId
  return {
    accountId: auth.accountId,
    actor: isKey
      ? { type: 'api_key', id: auth.apiKeyId, role: auth.role, onBehalfOf: auth.userId }
      : { type: 'user', id: auth.userId, role: auth.role },
    source: source ?? (isKey ? 'api' : 'web'),
    requestId: h?.get('x-request-id') ?? null,
    ip: h ? clientIp(h) : null,
    userAgent: h?.get('user-agent') ?? null,
  }
}

/** For work no person started: sweeps, cron, start-up. */
export function systemCtx(accountId: string | null, job: string, correlationId?: string | null): AuditContext {
  return { accountId, actor: { type: 'system', id: job }, source: 'job', correlationId: correlationId ?? null }
}

/** For an inbound webhook or other outside caller. */
export function webhookCtx(accountId: string | null, provider: string, req?: Request | HeaderLike | null): AuditContext {
  const h = headersOf(req)
  return {
    accountId,
    actor: { type: 'webhook', id: provider },
    source: 'webhook',
    requestId: h?.get('x-request-id') ?? null,
    ip: h ? clientIp(h) : null,
    userAgent: h?.get('user-agent') ?? null,
  }
}

/**
 * For an AI or automation agent. `kind`: ai_reply, admin_chat, chatbot,
 * flow, automation, registration. `onBehalfOf`: the staff member who
 * started it, if one did (null when a customer's message started it).
 */
export function agentCtx(
  accountId: string,
  kind: string,
  opts: { onBehalfOf?: string | null; correlationId?: string | null; source?: AuditSource } = {},
): AuditContext {
  return {
    accountId,
    actor: { type: 'agent', id: kind, onBehalfOf: opts.onBehalfOf ?? null },
    source: opts.source ?? 'ai',
    correlationId: opts.correlationId ?? null,
  }
}

/** For a person using a public link or form (no login). */
export function publicCtx(accountId: string, req: Request | HeaderLike, what: string): AuditContext {
  const h = headersOf(req)
  return {
    accountId,
    actor: { type: 'public', id: what },
    source: 'public',
    requestId: h?.get('x-request-id') ?? null,
    ip: h ? clientIp(h) : null,
    userAgent: h?.get('user-agent') ?? null,
  }
}
