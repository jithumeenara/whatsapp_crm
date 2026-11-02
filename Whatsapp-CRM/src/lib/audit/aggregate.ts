/**
 * Counted, not logged one by one: failed sign-ins, failed codes, rate-limit
 * refusals and 403s. One event per key per minute keeps the log readable
 * under a brute-force attempt — without hiding it (plan §5, review M1):
 *
 *  - by source address: count, how many different targets, five samples.
 *    A password spray across 500 accounts shows as "1 IP, 500 targets".
 *  - by target: written only when more than one address tried the same
 *    target, so a spread-out attack on one login shows as "1 target, 40 IPs".
 *
 * Targets are kept as keyed hashes (pepper.ts), never as the email typed.
 * The counters live in this process and are written every minute and when
 * the process is about to exit; a crash loses at most a minute.
 */

import { audit, type AuditActor, type AuditContext, type AuditEntry } from './write'
import type { AuditAction } from './actions'
import { emailHmac, targetHash } from './pepper'

export type AggregatedAction = Extract<AuditAction, 'auth.login_fail' | 'auth.mfa_fail' | 'auth.rate_limited' | 'access.denied'>

export const WINDOW_MS = 60_000
const MAX_KEYS = 5_000
const MAX_SAMPLES = 5
const MAX_TRACKED_TARGETS = 1_000

export interface Hit {
  action: AggregatedAction
  accountId: string | null
  reason?: string | null
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
  actor: AuditActor
  /** Raw target value (email typed, user id, path). Hashed before it is kept. */
  targetValue?: string | null
  /** Set when the target is a known record (a user id, a route). */
  target?: { type: string; id?: string | null } | null
  /** Whether the target value is an email to be stored as meta.email_hmac. */
  targetIsEmail?: boolean
  /** Small, fixed extras that are part of the key (bucket, required role). */
  meta?: Record<string, string | number | boolean | null>
  at?: number
}

interface TargetInfo { target?: { type: string; id?: string | null } | null; emailHmac?: string }

interface Bucket {
  by: 'ip' | 'target'
  action: AggregatedAction
  accountId: string | null
  reason: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
  actor: AuditActor
  meta: Record<string, string | number | boolean | null>
  count: number
  first: number
  last: number
  targets: Map<string, TargetInfo>
  targetsOverflow: number
  ips: Set<string>
}

let buckets = new Map<string, Bucket>()
let droppedKeys = 0
let timer: ReturnType<typeof setInterval> | null = null
let exitHooked = false

function keyOf(parts: Array<string | null | undefined>): string {
  return parts.map((p) => p ?? '').join('|')
}

function newBucket(by: Bucket['by'], h: Hit, at: number): Bucket {
  return {
    by,
    action: h.action,
    accountId: h.accountId,
    reason: h.reason ?? null,
    ip: by === 'ip' ? h.ip ?? null : null,
    userAgent: by === 'ip' ? h.userAgent ?? null : null,
    requestId: h.requestId ?? null,
    actor: h.actor,
    meta: h.meta ?? {},
    count: 0,
    first: at,
    last: at,
    targets: new Map(),
    targetsOverflow: 0,
    ips: new Set(),
  }
}

function touch(key: string, by: Bucket['by'], h: Hit, at: number, th: string | null, info: TargetInfo): void {
  let b = buckets.get(key)
  if (!b) {
    if (buckets.size >= MAX_KEYS) { droppedKeys++; return }
    b = newBucket(by, h, at)
    buckets.set(key, b)
  }
  b.count++
  b.last = at
  if (th) {
    if (b.targets.has(th) || b.targets.size < MAX_TRACKED_TARGETS) b.targets.set(th, info)
    else b.targetsOverflow++
  }
  if (h.ip && b.ips.size < MAX_TRACKED_TARGETS) b.ips.add(h.ip)
}

/** Counts one hit. Pure apart from the in-memory counters; never throws. */
export function record(h: Hit): void {
  try {
    const at = h.at ?? Date.now()
    const th = h.targetValue ? targetHash(h.targetValue) : null
    const info: TargetInfo = {
      target: h.target ?? null,
      emailHmac: h.targetIsEmail && h.targetValue ? emailHmac(h.targetValue) : undefined,
    }
    const fixed = JSON.stringify(h.meta ?? {})
    touch(keyOf(['ip', h.action, h.accountId, h.reason, h.ip, h.actor.type, h.actor.id, fixed]), 'ip', h, at, th, info)
    if (th) touch(keyOf(['target', h.action, h.accountId, h.reason, th, fixed]), 'target', h, at, th, info)
    ensureTimer()
  } catch (err) {
    console.error('[audit] aggregate record failed:', err instanceof Error ? err.message : err)
  }
}

/** Turns the counters into events. Pure: exported for tests. */
export function toEvents(list: Iterable<Bucket>): Array<{ ctx: AuditContext; entry: AuditEntry }> {
  const out: Array<{ ctx: AuditContext; entry: AuditEntry }> = []
  for (const b of list) {
    // By target only says something the by-address event does not when
    // the same target was tried from more than one place.
    if (b.by === 'target' && b.ips.size <= 1) continue
    const infos = [...b.targets.values()]
    const single = b.targets.size === 1 && b.targetsOverflow === 0 ? infos[0] : null
    const meta: Record<string, unknown> = {
      ...b.meta,
      by: b.by,
      count: b.count,
      distinct_targets: b.targets.size + b.targetsOverflow,
      sample_targets: [...b.targets.keys()].slice(0, MAX_SAMPLES),
      first_at: new Date(b.first).toISOString(),
      last_at: new Date(b.last).toISOString(),
    }
    if (b.by === 'target') meta.distinct_ips = b.ips.size
    if (single?.emailHmac) meta.email_hmac = single.emailHmac
    out.push({
      ctx: {
        accountId: b.accountId,
        actor: b.actor,
        source: 'web',
        ip: b.ip,
        userAgent: b.userAgent,
        requestId: b.count === 1 ? b.requestId : null,
      },
      entry: {
        action: b.action,
        outcome: b.action === 'access.denied' || b.action === 'auth.rate_limited' ? 'denied' : 'failure',
        reason: b.reason,
        target: single?.target ? { type: single.target.type, id: single.target.id ?? null } : null,
        meta,
      },
    })
  }
  return out
}

/** Writes every counter as events and starts a fresh window. */
export async function flushAuditAggregates(): Promise<void> {
  const current = buckets
  buckets = new Map()
  const dropped = droppedKeys
  droppedKeys = 0
  const events = toEvents(current.values())
  for (const { ctx, entry } of events) await audit(ctx, entry)
  if (dropped > 0) {
    await audit(
      { accountId: null, actor: { type: 'system', id: 'audit-aggregate' }, source: 'system' },
      { action: 'system.audit_write_failed', outcome: 'failure', reason: 'aggregate counters full', meta: { dropped_keys: dropped } },
    )
  }
}

function ensureTimer(): void {
  if (!timer) {
    timer = setInterval(() => void flushAuditAggregates().catch(() => {}), WINDOW_MS)
    timer.unref?.()
  }
  if (!exitHooked && typeof process !== 'undefined' && typeof process.once === 'function') {
    exitHooked = true
    // beforeExit fires when the event loop drains (a clean stop). A signal
    // stop is handled by whoever owns SIGTERM calling flushAuditAggregates().
    process.once('beforeExit', () => void flushAuditAggregates().catch(() => {}))
  }
}

// ── The three things callers record ────────────────────────────────

interface Where { ip?: string | null; userAgent?: string | null; requestId?: string | null }

/**
 * A failed sign-in or code. `reason` is for the log only — the person is
 * never told which part was wrong. For an unknown email the address is
 * kept only as an HMAC (meta.email_hmac); for a known user, their id.
 */
export function recordLoginFailure(args: Where & {
  action?: 'auth.login_fail' | 'auth.mfa_fail'
  reason: 'unknown_user' | 'bad_password' | 'mfa_missing' | 'mfa_invalid' | 'no_password' | string
  /** What was typed (email or phone) — hashed, never stored. */
  typed?: string | null
  /** When the input matched a user. */
  user?: { id: string; accountId: string | null } | null
}): void {
  const known = args.user ?? null
  record({
    action: args.action ?? 'auth.login_fail',
    accountId: known?.accountId ?? null,
    reason: args.reason,
    ip: args.ip,
    userAgent: args.userAgent,
    requestId: args.requestId,
    actor: { type: 'public', id: 'login' },
    targetValue: known ? known.id : args.typed ?? null,
    targetIsEmail: !known && !!args.typed,
    target: known ? { type: 'user', id: known.id } : null,
  })
}

/** A refusal by a rate limit. `bucket` is the limiter's name, not its key. */
export function recordRateLimited(args: Where & {
  bucket: string
  accountId?: string | null
  actor?: AuditActor
  /** The person or input the limit was for — hashed. */
  targetValue?: string | null
}): void {
  record({
    action: 'auth.rate_limited',
    accountId: args.accountId ?? null,
    reason: args.bucket,
    ip: args.ip,
    userAgent: args.userAgent,
    requestId: args.requestId,
    actor: args.actor ?? { type: 'public', id: args.bucket },
    targetValue: args.targetValue ?? null,
    meta: { bucket: args.bucket },
  })
}

/** A 403 from requireRole / requirePageAccess. */
export function recordDenied(args: Where & {
  accountId: string
  userId: string
  role: string
  required?: string | null
  page?: string | null
  path?: string | null
}): void {
  record({
    action: 'access.denied',
    accountId: args.accountId,
    reason: args.page ? 'page_access' : 'role',
    ip: args.ip,
    userAgent: args.userAgent,
    requestId: args.requestId,
    actor: { type: 'user', id: args.userId, role: args.role },
    targetValue: args.path ?? null,
    target: args.path ? { type: 'route', id: args.path.slice(0, 100) } : null,
    meta: { required_role: args.required ?? null, page: args.page ?? null, path: args.path ? args.path.slice(0, 120) : null },
  })
}

/** Tests only. */
export function __bucketsForTests(): Bucket[] {
  return [...buckets.values()]
}
export function __resetAggregatesForTests(): void {
  buckets = new Map()
  droppedKeys = 0
}
