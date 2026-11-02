/**
 * The only writer of the audit log. Each account has its own chain: one
 * writer at a time (an advisory lock), the next seq and the previous hash
 * read from audit_chain_heads under that lock, the row hashed over every
 * column (hash.ts), inserted, and the head moved — in one transaction.
 *
 * audit()      best effort: never throws, never slows the action much; a
 *              failed write goes to the signed fallback file (fallback.ts)
 * auditInTx()  fail closed, inside the caller's transaction, for actions a
 *              person starts that must not happen unrecorded (plan §7)
 *
 * No other code may write audit_events; the database refuses changes.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { categoryOf, type AuditAction } from './actions'
import { genesisHash, rowHash, type ChainRow } from './hash'
import { cleanObject, cleanText, diff, MAX_EVENT_BYTES, MAX_REASON } from './sanitize'

/** Events with no account (failed login with an unknown email, sign-up,
 *  proxy rate limits) go to this chain; only the platform owner reads it. */
export const PLATFORM_ACCOUNT = '00000000-0000-0000-0000-000000000000'

export type ActorType = 'user' | 'api_key' | 'agent' | 'system' | 'webhook' | 'public'
export type AuditSource = 'web' | 'api' | 'mcp' | 'job' | 'webhook' | 'ai' | 'admin_chat' | 'public' | 'system'

export interface AuditActor {
  type: ActorType
  /** user id, api key id, agent kind ("ai_reply"), job or provider name */
  id?: string | null
  label?: string | null
  role?: string | null
  /** The human an agent or key acted for. */
  onBehalfOf?: string | null
}

export interface AuditContext {
  accountId: string | null
  actor: AuditActor
  source: AuditSource
  requestId?: string | null
  correlationId?: string | null
  ip?: string | null
  userAgent?: string | null
}

export interface AuditEntry {
  action: AuditAction
  outcome?: 'success' | 'denied' | 'failure'
  reason?: string | null
  target?: { type: string; id?: string | number | bigint | null; label?: string | null } | null
  /** Precomputed { field: [before, after] }, or give before/after. */
  changes?: Record<string, unknown> | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  /** Limit the diff to these fields. */
  only?: readonly string[]
  meta?: Record<string, unknown> | null
}

type Prepared = Omit<ChainRow, 'id' | 'seq' | 'prev_hash' | 'occurred_at' | 'ingested_at'> & { occurred_at?: Date }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A record id is kept exactly (it must stay findable); only an id-like
 *  value qualifies — anything else is treated as text and masked. */
function cleanId(v: string): string | null {
  return /^[A-Za-z0-9_:.\-]{1,100}$/.test(v) ? v : cleanText(v, 100)
}

export function auditEnabled(): boolean {
  return (process.env.AUDIT_LOG ?? 'on').trim().toLowerCase() !== 'off'
}

/** Builds the stored shape: validated, cleaned, capped. Pure. */
export function prepare(ctx: AuditContext, e: AuditEntry): Prepared {
  const category = categoryOf(e.action)
  if (!category) throw new Error(`Unknown audit action: ${String(e.action).slice(0, 60)}`)
  // Lower case: Postgres stores uuids that way, so the hash and the lock key match what is read back.
  const accountId = ctx.accountId && UUID.test(ctx.accountId) ? ctx.accountId.toLowerCase() : PLATFORM_ACCOUNT
  const changes = e.changes !== undefined ? cleanObject(e.changes) : diff(e.before, e.after, { only: e.only })
  let meta = cleanObject(e.meta ?? null)
  // Keep each event small: the list view and the hash both stay cheap.
  const size = JSON.stringify(changes ?? {}).length + JSON.stringify(meta ?? {}).length
  if (size > MAX_EVENT_BYTES) meta = { note: `details too large to keep (${size} bytes)` }
  return {
    account_id: accountId,
    actor_type: ctx.actor.type,
    actor_id: cleanText(ctx.actor.id, 100),
    actor_label: cleanText(ctx.actor.label, 120),
    actor_role: cleanText(ctx.actor.role, 30),
    on_behalf_of: ctx.actor.onBehalfOf && UUID.test(ctx.actor.onBehalfOf) ? ctx.actor.onBehalfOf.toLowerCase() : null,
    action: e.action,
    category,
    outcome: e.outcome ?? 'success',
    reason: cleanText(e.reason, MAX_REASON),
    target_type: cleanText(e.target?.type, 40),
    target_id: e.target?.id === null || e.target?.id === undefined ? null : cleanId(String(e.target.id)),
    target_label: cleanText(e.target?.label, 120),
    changes: size > MAX_EVENT_BYTES ? { note: 'too large to keep' } : changes,
    request_id: cleanText(ctx.requestId, 80),
    correlation_id: cleanText(ctx.correlationId, 80),
    source: ctx.source,
    // An address is kept as given (no digit masking), only validated.
    ip: ctx.ip && /^[0-9a-fA-F:.]{2,64}$/.test(ctx.ip) ? ctx.ip : null,
    user_agent: cleanText(ctx.userAgent, 300),
    meta,
  }
}

type Tx = Prisma.TransactionClient

/** Partitions this process has already asked for, by "YYYY-MM". */
const ensuredMonths = new Set<string>()

/**
 * Asks for a month's partition OUTSIDE any business transaction, and never
 * lets a failure stop the write: a missing partition only means the row
 * lands in the default partition (and the daily check alarms). Cached only
 * once it has really been created.
 */
async function ensureMonths(dates: Date[]): Promise<void> {
  for (const key of new Set(dates.map((d) => d.toISOString().slice(0, 7)))) {
    if (ensuredMonths.has(key)) continue
    try {
      await prisma.$queryRaw`SELECT audit_ensure_partition(${`${key}-01`}::date)::text`
      ensuredMonths.add(key)
    } catch (err) {
      console.error(`[audit] partition ${key} not created (rows go to the default partition):`, err instanceof Error ? err.message : err)
    }
  }
}

/** Appends rows that all belong to one account, under that chain's lock. */
async function appendInTx(tx: Tx, accountId: string, rows: Prepared[], replay?: { ingestedAt: Date }): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit:${accountId}`}))::text`
  const head = await tx.$queryRaw<Array<{ last_seq: bigint; last_hash: string }>>`
    SELECT last_seq, last_hash FROM audit_chain_heads WHERE account_id = ${accountId}::uuid FOR UPDATE`
  let seq = head[0]?.last_seq ?? BigInt(0)
  let prev = head[0]?.last_hash ?? genesisHash(accountId)
  let lastId = BigInt(0)
  for (const r of rows) {
    // Millisecond precision: what JS reads back is exactly what was hashed.
    const now = new Date()
    const occurredAt = r.occurred_at ?? now
    const ingestedAt = replay?.ingestedAt ?? now
    const idRow = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval('audit_events_id_seq') AS id`
    const id = idRow[0].id
    seq += BigInt(1)
    const row: ChainRow = { ...r, id, seq, occurred_at: occurredAt, ingested_at: ingestedAt, prev_hash: prev }
    const hash = rowHash(row)
    await tx.auditEvent.create({
      data: {
        ...row,
        id,
        seq,
        occurred_at: occurredAt,
        ingested_at: ingestedAt,
        changes: row.changes === null || row.changes === undefined ? Prisma.DbNull : (row.changes as Prisma.InputJsonValue),
        meta: row.meta === null || row.meta === undefined ? Prisma.DbNull : (row.meta as Prisma.InputJsonValue),
        row_hash: hash,
      },
    })
    prev = hash
    lastId = id
  }
  await tx.$executeRaw`
    INSERT INTO audit_chain_heads (account_id, last_seq, last_id, last_hash, updated_at)
    VALUES (${accountId}::uuid, ${seq}, ${lastId}, ${prev}, now())
    ON CONFLICT (account_id) DO UPDATE SET last_seq = EXCLUDED.last_seq, last_id = EXCLUDED.last_id,
      last_hash = EXCLUDED.last_hash, updated_at = now()`
}

function group(rows: Prepared[]): Map<string, Prepared[]> {
  const by = new Map<string, Prepared[]>()
  for (const r of rows) by.set(r.account_id, [...(by.get(r.account_id) ?? []), r])
  return by
}

/** Low-level: append already-prepared rows (used by audit() and the fallback replay). */
export async function appendPrepared(rows: Prepared[], replay?: { ingestedAt: Date }): Promise<void> {
  await ensureMonths(rows.map((r) => r.occurred_at ?? new Date()))
  for (const [accountId, list] of group(rows)) {
    await prisma.$transaction((tx) => appendInTx(tx, accountId, list, replay), { timeout: 10_000 })
  }
}

/** Records one or more events. Never throws; a failure is kept in the
 *  signed fallback file and replayed later. */
export async function audit(ctx: AuditContext, entries: AuditEntry | AuditEntry[]): Promise<void> {
  if (!auditEnabled()) return
  let rows: Prepared[]
  try {
    rows = (Array.isArray(entries) ? entries : [entries]).map((e) => prepare(ctx, e))
  } catch (err) {
    console.error('[audit] event refused:', err instanceof Error ? err.message : err)
    return
  }
  try {
    await appendPrepared(rows)
  } catch (err) {
    console.error('[audit] write failed, kept for replay:', err instanceof Error ? err.message : err)
    const { keepForReplay } = await import('./fallback')
    await keepForReplay(rows.map((r) => ({ ...r, occurred_at: r.occurred_at ?? new Date() }))).catch(() => {})
  }
}

/** Records events inside the caller's transaction: if this fails, so does
 *  the action. Only for security-critical actions a person starts. */
export async function auditInTx(tx: Tx, ctx: AuditContext, entries: AuditEntry | AuditEntry[]): Promise<void> {
  if (!auditEnabled()) return
  const rows = (Array.isArray(entries) ? entries : [entries]).map((e) => prepare(ctx, e))
  for (const [accountId, list] of group(rows)) await appendInTx(tx, accountId, list)
}
