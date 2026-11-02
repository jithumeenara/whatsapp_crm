/**
 * Reading the audit log, for /api/audit/* only (plan §6, §9, §15).
 *
 * Every query here is scoped by the account the caller resolved through
 * requireRole — never an id from the request. Filters are checked against
 * allow-lists or formats before they reach Prisma; an unknown parameter is
 * refused rather than ignored, so a typo never silently widens a search.
 * Names of people are joined at read time from profiles, never stored.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ForbiddenError, type AccountContext } from '@/lib/auth/account'
import { isPlatformOwner } from '@/lib/auth/platform-owner'
import { AUDIT_CATEGORIES, categoryOf } from './actions'
import { PLATFORM_ACCOUNT } from './write'

export const ACTOR_KINDS = ['agent', 'api_key', 'system', 'webhook', 'public'] as const
export const OUTCOMES = ['success', 'denied', 'failure'] as const
export const MAX_PAGE = 100
export const MAX_SEARCH_DAYS = 92
export const MAX_RANGE_DAYS = 366
export const DEFAULT_DAYS = 7

const DAY_MS = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/
const TOKEN = /^[\w.:\-]{1,100}$/
const TYPE = /^[a-z][a-z0-9_]{0,39}$/
const CONTROL = /[\u0000-\u001f\u007f]/g

export const FILTER_KEYS = [
  'from', 'to', 'actor', 'category', 'action', 'outcome',
  'target_type', 'target_id', 'request_id', 'correlation_id', 'q',
] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
const PAGING_KEYS = ['cursor', 'limit', 'scope'] as const

export interface AuditFilters {
  from: Date
  to: Date
  actor?: string
  category?: string
  action?: string
  outcome?: string
  target_type?: string
  target_id?: string
  request_id?: string
  correlation_id?: string
  q?: string
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

type Getter = (key: string) => string | null

function bad<T>(error: string): Parsed<T> {
  return { ok: false, error }
}

/**
 * Checks every filter. `get` reads one parameter; `keys` lists what was
 * sent, so an unknown name is refused. `now` comes from the caller (tests).
 */
export function parseFilters(get: Getter, keys: Iterable<string>, now: Date = new Date(), extraKeys: readonly string[] = PAGING_KEYS): Parsed<AuditFilters> {
  const allowed = new Set<string>([...FILTER_KEYS, ...extraKeys])
  for (const k of keys) if (!allowed.has(k)) return bad(`Unknown filter: ${k.slice(0, 40)}`)

  const val = (k: string) => {
    const v = get(k)
    return v === null ? undefined : v.trim() || undefined
  }

  const parseTime = (k: 'from' | 'to'): Parsed<Date | undefined> => {
    const v = val(k)
    if (v === undefined) return { ok: true, value: undefined }
    if (!ISO_WITH_ZONE.test(v)) return bad(`"${k}" must be a date and time with its zone, e.g. 2026-11-02T00:00:00+05:30`)
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return bad(`"${k}" is not a real date`)
    return { ok: true, value: d }
  }
  const pf = parseTime('from')
  if (!pf.ok) return pf as Parsed<AuditFilters>
  const pt = parseTime('to')
  if (!pt.ok) return pt as Parsed<AuditFilters>
  const to = pt.value ?? now
  const from = pf.value ?? new Date(to.getTime() - DEFAULT_DAYS * DAY_MS)
  if (from.getTime() >= to.getTime()) return bad('The start of the period must be before its end')

  const f: AuditFilters = { from, to }

  const actor = val('actor')
  if (actor !== undefined) {
    if (!UUID.test(actor) && !(ACTOR_KINDS as readonly string[]).includes(actor)) return bad('Unknown "who" filter')
    f.actor = actor.toLowerCase()
  }
  const category = val('category')
  if (category !== undefined) {
    if (!(AUDIT_CATEGORIES as readonly string[]).includes(category)) return bad('Unknown category')
    f.category = category
  }
  const action = val('action')
  if (action !== undefined) {
    if (!categoryOf(action)) return bad('Unknown action')
    f.action = action
  }
  const outcome = val('outcome')
  if (outcome !== undefined) {
    if (!(OUTCOMES as readonly string[]).includes(outcome)) return bad('Unknown outcome')
    f.outcome = outcome
  }
  const targetType = val('target_type')
  if (targetType !== undefined) {
    if (!TYPE.test(targetType)) return bad('Unknown record type')
    f.target_type = targetType
  }
  const targetId = val('target_id')
  if (targetId !== undefined) {
    if (!TOKEN.test(targetId)) return bad('Record id has characters that are not allowed')
    f.target_id = targetId
  }
  for (const k of ['request_id', 'correlation_id'] as const) {
    const v = val(k)
    if (v === undefined) continue
    if (v.length > 80 || !TOKEN.test(v)) return bad(`"${k}" has characters that are not allowed`)
    f[k] = v
  }
  const q = val('q')
  if (q !== undefined) {
    const clean = q.replace(CONTROL, '').slice(0, 100).trim()
    if (clean) f.q = clean
  }

  const span = (to.getTime() - from.getTime()) / DAY_MS
  if (f.q && span > MAX_SEARCH_DAYS) return bad(`Text search covers at most ${MAX_SEARCH_DAYS} days — pick a shorter period`)
  if (span > MAX_RANGE_DAYS) return bad(`Pick a period of at most ${MAX_RANGE_DAYS} days`)
  return { ok: true, value: f }
}

/** From a URLSearchParams (GET). */
export function filtersFromSearch(sp: URLSearchParams, now?: Date, extraKeys?: readonly string[]): Parsed<AuditFilters> {
  return parseFilters((k) => sp.get(k), sp.keys(), now, extraKeys)
}

/** From a JSON object (export body). Non-string values are refused. */
export function filtersFromObject(obj: unknown, now?: Date): Parsed<AuditFilters> {
  if (obj === undefined || obj === null) return parseFilters(() => null, [], now, [])
  if (typeof obj !== 'object' || Array.isArray(obj)) return bad('Filters must be an object')
  const o = obj as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && v !== undefined && typeof v !== 'string') return bad(`"${k.slice(0, 40)}" must be text`)
  }
  return parseFilters((k) => (typeof o[k] === 'string' ? (o[k] as string) : null), Object.keys(o), now, [])
}

/** The same filters as plain strings, for an export's own record of itself. */
export function filtersForRecord(f: AuditFilters): Record<string, string> {
  const out: Record<string, string> = { from: f.from.toISOString(), to: f.to.toISOString() }
  for (const k of FILTER_KEYS) {
    if (k === 'from' || k === 'to') continue
    const v = f[k]
    if (v) out[k] = v
  }
  return out
}

// ── Cursor ────────────────────────────────────────────────────────────

export interface Cursor { at: Date; id: bigint }

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.at.getTime()}:${c.id.toString()}`).toString('base64url')
}

export function decodeCursor(s: string | null | undefined): Parsed<Cursor | null> {
  if (!s) return { ok: true, value: null }
  if (s.length > 60 || !/^[A-Za-z0-9_-]+$/.test(s)) return bad('Bad page cursor')
  const m = /^(\d{1,15}):(\d{1,19})$/.exec(Buffer.from(s, 'base64url').toString('utf8'))
  if (!m) return bad('Bad page cursor')
  return { ok: true, value: { at: new Date(Number(m[1])), id: BigInt(m[2]) } }
}

export function parseLimit(s: string | null, fallback = 50): Parsed<number> {
  if (s === null || s === '') return { ok: true, value: fallback }
  if (!/^\d{1,3}$/.test(s)) return bad('"limit" must be a number')
  const n = Number(s)
  if (n < 1 || n > MAX_PAGE) return bad(`"limit" must be between 1 and ${MAX_PAGE}`)
  return { ok: true, value: n }
}

// ── Scope ─────────────────────────────────────────────────────────────

/**
 * Which chain this caller reads. Their own account, always — unless they
 * ask for the platform chain and are the server's owner. Anyone else asking
 * for it is refused, never quietly shown their own log instead.
 */
export async function resolveScope(ctx: Pick<AccountContext, 'accountId' | 'userId'>, scope: string | null | undefined): Promise<string> {
  if (scope === undefined || scope === null || scope === '' || scope === 'account') return ctx.accountId
  if (scope !== 'platform') throw new ForbiddenError('Unknown scope')
  if (!(await isPlatformOwner(ctx.userId))) throw new ForbiddenError('Only the owner of this server can read the platform log')
  return PLATFORM_ACCOUNT
}

// ── Query ─────────────────────────────────────────────────────────────

export function buildWhere(accountId: string, f: AuditFilters, cursor?: Cursor | null): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [
    { account_id: accountId },
    { occurred_at: { gte: f.from, lt: f.to } },
  ]
  if (f.actor) {
    if ((ACTOR_KINDS as readonly string[]).includes(f.actor)) and.push({ actor_type: f.actor })
    else and.push({ actor_type: 'user', actor_id: f.actor })
  }
  if (f.category) and.push({ category: f.category })
  if (f.action) and.push({ action: f.action })
  if (f.outcome) and.push({ outcome: f.outcome })
  if (f.target_type) and.push({ target_type: f.target_type })
  if (f.target_id) and.push({ target_id: f.target_id })
  if (f.request_id) and.push({ request_id: f.request_id })
  if (f.correlation_id) and.push({ correlation_id: f.correlation_id })
  if (f.q) {
    and.push({
      OR: [
        { target_label: { contains: f.q, mode: 'insensitive' } },
        { actor_label: { contains: f.q, mode: 'insensitive' } },
      ],
    })
  }
  if (cursor) {
    and.push({
      OR: [
        { occurred_at: { lt: cursor.at } },
        { occurred_at: cursor.at, id: { lt: cursor.id } },
      ],
    })
  }
  return { AND: and }
}

export const LIST_ORDER: Prisma.AuditEventOrderByWithRelationInput[] = [{ occurred_at: 'desc' }, { id: 'desc' }]

/** The columns a screen or an export needs. Never the hash inputs beyond
 *  what proves the row (row_hash), never anything unmasked — the writer
 *  already masked it. */
export const EVENT_SELECT = {
  id: true,
  seq: true,
  occurred_at: true,
  actor_type: true,
  actor_id: true,
  actor_label: true,
  actor_role: true,
  on_behalf_of: true,
  action: true,
  category: true,
  outcome: true,
  reason: true,
  target_type: true,
  target_id: true,
  target_label: true,
  changes: true,
  request_id: true,
  correlation_id: true,
  source: true,
  ip: true,
  user_agent: true,
  meta: true,
  row_hash: true,
} satisfies Prisma.AuditEventSelect

export type EventRow = Prisma.AuditEventGetPayload<{ select: typeof EVENT_SELECT }>

export interface EventOut {
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

/** Display names for the people in these rows: user id → name or email. */
export async function actorNames(rows: Array<Pick<EventRow, 'actor_type' | 'actor_id' | 'on_behalf_of'>>): Promise<Map<string, string>> {
  const ids = new Set<string>()
  for (const r of rows) {
    if (r.actor_type === 'user' && r.actor_id && UUID.test(r.actor_id)) ids.add(r.actor_id)
    if (r.on_behalf_of && UUID.test(r.on_behalf_of)) ids.add(r.on_behalf_of)
  }
  const out = new Map<string, string>()
  if (!ids.size) return out
  const people = await prisma.profile.findMany({
    where: { user_id: { in: [...ids] } },
    select: { user_id: true, full_name: true, email: true },
  })
  for (const p of people) out.set(p.user_id, p.full_name?.trim() || p.email)
  return out
}

export function toOut(r: EventRow, names: Map<string, string>): EventOut {
  return {
    id: r.id.toString(),
    seq: r.seq.toString(),
    occurred_at: r.occurred_at.toISOString(),
    actor_type: r.actor_type,
    actor_id: r.actor_id,
    actor_label: r.actor_label,
    actor_name: r.actor_type === 'user' && r.actor_id ? names.get(r.actor_id) ?? null : null,
    actor_role: r.actor_role,
    on_behalf_of: r.on_behalf_of,
    on_behalf_of_name: r.on_behalf_of ? names.get(r.on_behalf_of) ?? null : null,
    action: r.action,
    category: r.category,
    outcome: r.outcome,
    reason: r.reason,
    target_type: r.target_type,
    target_id: r.target_id,
    target_label: r.target_label,
    changes: r.changes ?? null,
    request_id: r.request_id,
    correlation_id: r.correlation_id,
    source: r.source,
    ip: r.ip,
    user_agent: r.user_agent,
    meta: r.meta ?? null,
    row_hash: r.row_hash,
  }
}

/** Rows plus their names, ready for JSON. */
export async function present(rows: EventRow[]): Promise<EventOut[]> {
  const names = await actorNames(rows)
  return rows.map((r) => toOut(r, names))
}

/** An event id from a URL: digits only, or nothing. */
export function parseEventId(s: string | undefined): bigint | null {
  if (!s || !/^\d{1,19}$/.test(s)) return null
  try {
    const n = BigInt(s)
    return n > BigInt(0) && n <= BigInt('9223372036854775807') ? n : null
  } catch {
    return null
  }
}
