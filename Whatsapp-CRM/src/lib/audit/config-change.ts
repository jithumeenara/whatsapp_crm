/**
 * One helper for every settings route: records WHICH fields changed,
 * never their values (plan §5 P1 config). Config holds tokens, prompts and
 * secrets; the log proves that something changed and who changed it.
 * Best-effort like audit(): never throws, never blocks the save.
 */

import type { AuditAction } from './actions'
import { audit, type AuditContext } from './write'
import { changedFieldNames } from './sanitize'

type ConfigAction = Extract<AuditAction, `config.${string}`>

/** Field names only. `before`/`after` may hold secrets: they never leave here. */
export function configFieldList(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  return changedFieldNames(before ?? {}, after ?? {})
}

export async function auditConfigChange(
  ctx: AuditContext,
  action: ConfigAction,
  opts: {
    area: string
    /** Row before the save (or null when new). */
    before?: Record<string, unknown> | null
    /** What was written. Only keys present here are compared. */
    after?: Record<string, unknown> | null
    /** Or give the field names directly (e.g. the keys of the update). */
    fields?: string[]
    target?: { type: string; id?: string | number | null; label?: string | null } | null
    /** Small, non-secret extras: scopes, provider, a verb. */
    meta?: Record<string, unknown>
    outcome?: 'success' | 'denied' | 'failure'
    reason?: string | null
  },
): Promise<void> {
  try {
    const fields = (opts.fields ?? configFieldList(opts.before, opts.after)).slice(0, 60).sort()
    await audit(ctx, {
      action,
      outcome: opts.outcome,
      reason: opts.reason ?? null,
      target: opts.target ?? { type: 'config', id: opts.area },
      meta: { area: opts.area, fields, ...(opts.meta ?? {}) },
    })
  } catch (err) {
    console.error('[audit] config change not recorded:', err instanceof Error ? err.message : err)
  }
}
