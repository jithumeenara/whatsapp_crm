/**
 * Audit helpers for work no person did directly: AI agents, engines,
 * inbound webhooks, sweeps, public links and refused sockets
 * (docs/plans/audit-log-plan.md §5 P3, §18).
 *
 * Every helper is best effort and never throws. They take names and ids,
 * never values: a tool's argument NAMES are kept (Object.keys), never what
 * the customer typed. Safe for server.ts (no 'next/server').
 */

import { audit, type AuditContext, type AuditSource } from './write'
import { agentCtx, systemCtx, webhookCtx, publicCtx } from './context'
import { countThrottled, onceWithin } from './throttle'

export type AgentKind = 'ai_reply' | 'admin_chat' | 'chatbot' | 'flow' | 'automation' | 'registration'

/** Who the agent is and which turn/run this is. Carried on a tool context. */
export interface AgentAuditInfo {
  kind: AgentKind
  /** The staff member who started it; null when a customer message did. */
  onBehalfOf?: string | null
  /** One id per AI turn / automation run / flow run. */
  correlationId?: string | null
  model?: string | null
  flowOrBotId?: string | null
  conversationId?: string | null
  messageId?: string | null
  approvalId?: string | null
  approvedBy?: string | null
  source?: AuditSource
}

type Target = { type: string; id?: string | number | bigint | null }

/** Argument names only — the values may be personal. */
export function argNames(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return []
  return Object.keys(args as Record<string, unknown>).slice(0, 30).sort()
}

function ctxOf(accountId: string, info: AgentAuditInfo): AuditContext {
  return agentCtx(accountId, info.kind, {
    onBehalfOf: info.onBehalfOf ?? null,
    correlationId: info.correlationId ?? null,
    source: info.source ?? (info.kind === 'admin_chat' ? 'admin_chat' : 'ai'),
  })
}

function agentMeta(info: AgentAuditInfo): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  if (info.model) m.model = info.model
  if (info.flowOrBotId) m.flow_or_bot_id = info.flowOrBotId
  if (info.conversationId) m.conversation_id = info.conversationId
  if (info.messageId) m.message_id = info.messageId
  if (info.approvalId) m.approval_id = info.approvalId
  if (info.approvedBy) m.approved_by = info.approvedBy
  return m
}

function safe(p: () => Promise<void>): Promise<void> {
  try {
    return p().catch((err) => console.error('[audit] actor event failed:', err instanceof Error ? err.message : err))
  } catch (err) {
    console.error('[audit] actor event failed:', err instanceof Error ? err.message : err)
    return Promise.resolve()
  }
}

/** An agent created, changed or deleted data. `fields`: names only. */
export function agentRecordWritten(
  accountId: string | null | undefined,
  info: AgentAuditInfo | null | undefined,
  w: { tool?: string | null; op: 'create' | 'update' | 'delete'; target: Target; fields?: string[]; extra?: Record<string, unknown> },
): Promise<void> {
  if (!accountId || !info) return Promise.resolve()
  return safe(() =>
    audit(ctxOf(accountId, info), {
      action: 'agent.record_written',
      target: w.target,
      meta: {
        ...agentMeta(info),
        ...(w.tool ? { tool: w.tool } : {}),
        op: w.op,
        ...(w.fields?.length ? { fields: [...w.fields].slice(0, 30).sort() } : {}),
        ...(w.extra ?? {}),
      },
    }),
  )
}

/** A WRITE tool was called (never for read tools). Argument names only. */
export function agentToolCalled(
  accountId: string | null | undefined,
  info: AgentAuditInfo | null | undefined,
  tool: string,
  args: unknown,
  outcome: 'success' | 'failure' = 'success',
): Promise<void> {
  if (!accountId || !info) return Promise.resolve()
  return safe(() =>
    audit(ctxOf(accountId, info), {
      action: 'agent.tool_called',
      outcome,
      meta: { ...agentMeta(info), tool, args: argNames(args) },
    }),
  )
}

/** The agent handed a conversation to a person. */
export function agentHandover(
  accountId: string | null | undefined,
  info: AgentAuditInfo | null | undefined,
  conversationId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!accountId || !info) return Promise.resolve()
  return safe(() =>
    audit(ctxOf(accountId, info), {
      action: 'agent.handover',
      target: { type: 'conversation', id: conversationId },
      meta: { ...agentMeta(info), conversation_id: conversationId, ...(extra ?? {}) },
    }),
  )
}

/** Admin-chat: a proposed action was confirmed or turned down. */
export function agentActionDecided(
  accountId: string,
  info: AgentAuditInfo,
  decision: 'confirmed' | 'rejected',
  tool: string,
  target?: Target | null,
  extra?: Record<string, unknown>,
): Promise<void> {
  return safe(() =>
    audit(ctxOf(accountId, info), {
      action: decision === 'confirmed' ? 'agent.action_confirmed' : 'agent.action_rejected',
      target: target ?? null,
      meta: { ...agentMeta(info), tool, ...(extra ?? {}) },
    }),
  )
}

// ── Sweeps ───────────────────────────────────────────────────────────

/** ONE summary per sweep run that changed something; nothing otherwise. */
export function jobWrote(job: string, accountId: string | null, changed: number, extra?: Record<string, unknown>): Promise<void> {
  if (!Number.isFinite(changed) || changed <= 0) return Promise.resolve()
  return safe(() => audit(systemCtx(accountId, job), { action: 'system.job_wrote', meta: { changed, ...(extra ?? {}) } }))
}

/** A sweep failed. The reason is a short message, never a stack. */
export function jobFailed(job: string, accountId: string | null, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err ?? 'failed')
  return safe(() => audit(systemCtx(accountId, job), { action: 'system.job_failed', outcome: 'failure', reason: reason.slice(0, 300) }))
}

/**
 * Runs a sweep, records one summary when it changed something and a
 * failure when it threw — then behaves exactly as the sweep did
 * (same value, same error).
 */
export async function withJobAudit<T>(job: string, run: () => Promise<T>, changedOf: (r: T) => number): Promise<T> {
  let result: T
  try {
    result = await run()
  } catch (err) {
    void jobFailed(job, null, err)
    throw err
  }
  let changed = 0
  try {
    changed = changedOf(result)
  } catch {
    changed = 0
  }
  void jobWrote(job, null, changed)
  return result
}

// ── Webhooks ─────────────────────────────────────────────────────────

interface HeaderLike { get(name: string): string | null }

/** A webhook WROTE business data (one event per write, not per message). */
export function webhookWrote(
  provider: string,
  accountId: string | null | undefined,
  target: Target,
  extra?: Record<string, unknown>,
  req?: Request | HeaderLike | null,
): Promise<void> {
  if (!accountId) return Promise.resolve()
  return safe(() =>
    audit(webhookCtx(accountId, provider, req), {
      action: 'system.webhook_received',
      target,
      meta: { provider, ...(extra ?? {}) },
    }),
  )
}

/** A payment confirmed by a provider webhook or reconcile job. */
export function paymentPaid(
  provider: string,
  accountId: string | null | undefined,
  target: Target,
  extra?: Record<string, unknown>,
  opts: { refunded?: boolean; job?: boolean } = {},
): Promise<void> {
  if (!accountId) return Promise.resolve()
  const ctx = opts.job ? systemCtx(accountId, `${provider}-reconcile`) : webhookCtx(accountId, provider)
  return safe(() =>
    audit(ctx, { action: opts.refunded ? 'payment.refunded' : 'payment.paid', target, meta: { provider, ...(extra ?? {}) } }),
  )
}

export const WEBHOOK_REJECT_WINDOW_MS = 60_000

/** Bad signature/secret: at most one event per provider (+account) per minute, with a count. */
export function webhookRejected(provider: string, accountId: string | null | undefined, reason: string): void {
  const key = `webhook:${provider}:${accountId ?? '-'}:${reason}`
  countThrottled(key, WEBHOOK_REJECT_WINDOW_MS, (count, firstAt, lastAt) =>
    audit(webhookCtx(accountId ?? null, provider), {
      action: 'system.webhook_rejected',
      outcome: 'denied',
      reason,
      meta: { provider, count, first_at: firstAt.toISOString(), last_at: lastAt.toISOString() },
    }),
  )
}

// ── Sockets ──────────────────────────────────────────────────────────

/** A socket join refused: one event per account+reason per minute. */
export function socketRefused(accountId: string | null | undefined, reason: string, userId?: string | null, ip?: string | null): void {
  const key = `socket:${accountId ?? '-'}:${reason}`
  countThrottled(key, 60_000, (count, firstAt, lastAt) =>
    audit(
      {
        accountId: accountId ?? null,
        actor: userId ? { type: 'user', id: userId } : { type: 'system', id: 'socket' },
        source: 'web',
        ip: ip ?? null,
      },
      {
        action: 'access.socket_refused',
        outcome: 'denied',
        reason,
        meta: { count, first_at: firstAt.toISOString(), last_at: lastAt.toISOString() },
      },
    ),
  )
}

// ── Files ────────────────────────────────────────────────────────────

/** Opt-in (AUDIT_LOG_FILE_VIEWS=on): one event per user per file per day. */
export function fileViewed(accountId: string, userId: string, role: string | null, path: string, req?: Request | HeaderLike | null): void {
  if ((process.env.AUDIT_LOG_FILE_VIEWS ?? '').trim().toLowerCase() !== 'on') return
  const day = new Date().toISOString().slice(0, 10)
  if (!onceWithin(`file:${accountId}:${userId}:${path}:${day}`, 24 * 60 * 60_000)) return
  const h = req && 'headers' in (req as Request) ? (req as Request).headers : (req as HeaderLike | null | undefined)
  void safe(() =>
    audit(
      {
        accountId,
        actor: { type: 'user', id: userId, role },
        source: 'web',
        requestId: h?.get('x-request-id') ?? null,
        userAgent: h?.get('user-agent') ?? null,
      },
      { action: 'access.file_viewed', target: { type: 'file', id: path.slice(0, 100) }, meta: { day } },
    ),
  )
}

// ── Public links ─────────────────────────────────────────────────────

export function publicFormSubmitted(accountId: string, req: Request | HeaderLike, what: string, meta: { table_id: string; ref?: string | null; count?: number }): Promise<void> {
  return safe(() =>
    audit(publicCtx(accountId, req, what), {
      action: 'public.form_submitted',
      target: { type: 'data_table', id: meta.table_id },
      meta,
    }),
  )
}

export function publicDetailsConfirmed(
  accountId: string,
  req: Request | HeaderLike,
  meta: { verification_id: string; state: string; fields: string[] },
): Promise<void> {
  return safe(() =>
    audit(publicCtx(accountId, req, 'details_check'), {
      action: 'public.details_confirmed',
      target: { type: 'sheet_verification', id: meta.verification_id },
      meta: { ...meta, fields: [...meta.fields].slice(0, 40).sort() },
    }),
  )
}
