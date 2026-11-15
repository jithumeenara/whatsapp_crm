/**
 * The working-day numbers behind the Agent report card and the deeper
 * Lead report (docs/plans/reports-sections-plan.md §4.1, §4.2, phase B):
 *
 * - calls by day and by hour of the day (when people pick up);
 * - talk time, from WhatsApp calls that were answered;
 * - follow-ups done on time;
 * - how long a new lead waited for its first call;
 * - leads nobody has touched for days.
 *
 * Where the numbers come from:
 * - A call an agent logs on a lead is a `lead_activities` row of type
 *   'call' with metadata.connected (src/app/api/leads/[id]/route.ts).
 *   Older calls were only status changes, so "time to first call" is
 *   counted from the first logged call in the account onwards.
 * - Talk time exists only for calls made through WhatsApp calling (the
 *   `calls` table); a phone call from the agent's own mobile has none.
 *   With no such calls the figure is left out, never shown as 0.
 *
 * Scope: `userId` null = the whole team, else that person's own work only.
 * The caller decides it from the role (registry.ts), never the request.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { ReportPeriod } from '../period'
import { zoneForSql } from '../summary'

// ── Pure parts (tested) ────────────────────────────────────────────────

/** Done within an hour after the due time still counts as on time. */
export const FOLLOW_UP_GRACE_MS = 60 * 60_000

export interface FollowUpRow {
  due_at: Date
  status: string
  completed_at: Date | null
}

export interface FollowUpStats {
  /** Follow-ups whose due time has passed, in the period. */
  due: number
  onTime: number
  late: number
  /** Still pending after the due time. */
  missed: number
  skipped: number
}

export function emptyFollowUps(): FollowUpStats {
  return { due: 0, onTime: 0, late: 0, missed: 0, skipped: 0 }
}

/** Adds one follow-up to the stats (only once its due time has passed). */
export function addFollowUp(s: FollowUpStats, r: FollowUpRow, now: Date): void {
  if (r.due_at.getTime() > now.getTime()) return
  s.due += 1
  if (r.status === 'skipped') s.skipped += 1
  else if (r.status === 'done') {
    // Done without a recorded time: never call it late on a guess.
    if (!r.completed_at || r.completed_at.getTime() <= r.due_at.getTime() + FOLLOW_UP_GRACE_MS) s.onTime += 1
    else s.late += 1
  } else s.missed += 1
}

export function followUpStats(rows: FollowUpRow[], now: Date): FollowUpStats {
  const s = emptyFollowUps()
  for (const r of rows) addFollowUp(s, r, now)
  return s
}

/** On time ÷ (due − skipped), one decimal. Null when nothing counts. */
export function onTimePct(s: FollowUpStats): number | null {
  const base = s.due - s.skipped
  return base > 0 ? Math.round((s.onTime / base) * 1000) / 10 : null
}

export type WaitBucket = 'min5' | 'hour1' | 'day1' | 'later' | 'none'
export const WAIT_BUCKETS: WaitBucket[] = ['min5', 'hour1', 'day1', 'later', 'none']

/** Minutes from lead to first call (null = not called yet) → buckets. */
export function firstCallBuckets(minutes: Array<number | null>): Record<WaitBucket, number> {
  const b: Record<WaitBucket, number> = { min5: 0, hour1: 0, day1: 0, later: 0, none: 0 }
  for (const m of minutes) {
    if (m == null || !Number.isFinite(m)) b.none += 1
    else if (m <= 5) b.min5 += 1
    else if (m <= 60) b.hour1 += 1
    else if (m <= 1440) b.day1 += 1
    else b.later += 1
  }
  return b
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export type IdleBucket = 'd3' | 'd7' | 'd14' | 'd30'
export const IDLE_BUCKETS: IdleBucket[] = ['d3', 'd7', 'd14', 'd30']
/** Below this many days without a touch a lead is not idle. */
export const IDLE_MIN_DAYS = 3

export function idleBucket(days: number): IdleBucket | null {
  if (!Number.isFinite(days) || days < IDLE_MIN_DAYS) return null
  if (days < 7) return 'd3'
  if (days < 14) return 'd7'
  if (days < 30) return 'd14'
  return 'd30'
}

// ── Loaders ────────────────────────────────────────────────────────────

export interface ActivityArgs {
  accountId: string
  userId: string | null
  period: ReportPeriod
  tz: string
  now: Date
}

export interface CallSlot { calls: number; connected: number }

export interface Activity {
  /** "YYYY-MM-DD" in the business zone → calls that day. */
  callsByDay: Map<string, CallSlot>
  /** 24 slots, business-zone hours. */
  callsByHour: CallSlot[]
  /** WhatsApp calls answered and their talk time, per agent. */
  talk: Map<string, { answered: number; seconds: number }>
  followUps: { team: FollowUpStats; byUser: Map<string, FollowUpStats> }
  firstCall: {
    /** null when no call was ever logged in the account. */
    countedSince: string | null
    buckets: Record<WaitBucket, number>
    medianMinutes: number | null
    /** Per current owner of the lead. */
    byUser: Map<string, { minutes: number[]; none: number }>
  }
  idle: {
    total: number
    buckets: Record<IdleBucket, number>
    byUser: Map<string, number>
    /** The ten that have waited longest. */
    oldest: Array<{ id: string; title: string; days: number; owner: string | null }>
  }
}

const IDLE_ROW_CAP = 5000
const FOLLOW_UP_CAP = 50_000

export async function loadActivity(a: ActivityArgs): Promise<Activity> {
  const { accountId, userId, period: p, now } = a
  const zone = await zoneForSql(prisma, a.tz, now)
  const byMe = userId ? Prisma.sql`AND a.user_id = ${userId}::uuid` : Prisma.empty
  const ownedByMe = userId ? Prisma.sql`AND l.assigned_to = ${userId}::uuid` : Prisma.empty
  const agentIsMe = userId ? Prisma.sql`AND c.agent_id = ${userId}::uuid` : Prisma.empty
  const dueTo = new Date(Math.min(p.to.getTime(), now.getTime()))

  const [callRows, talkRows, fuRows, firstLogged, firstRows, idleRows] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string; hour: number; total: bigint; connected: bigint }>>`
      SELECT ((a.created_at AT TIME ZONE ${zone})::date)::text AS day,
             EXTRACT(hour FROM (a.created_at AT TIME ZONE ${zone}))::int AS hour,
             count(*) AS total,
             count(*) FILTER (WHERE (a.metadata->>'connected')::boolean) AS connected
      FROM lead_activities a
      WHERE a.account_id = ${accountId}::uuid AND a.type = 'call'
        AND a.created_at >= ${p.from} AND a.created_at < ${p.to} ${byMe}
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ agent_id: string; answered: bigint; secs: bigint | null }>>`
      SELECT c.agent_id::text AS agent_id, count(*) AS answered, sum(c.duration_seconds)::bigint AS secs
      FROM calls c
      WHERE c.account_id = ${accountId}::uuid AND c.agent_id IS NOT NULL AND c.answered_at IS NOT NULL
        AND c.duration_seconds IS NOT NULL AND c.started_at >= ${p.from} AND c.started_at < ${p.to} ${agentIsMe}
      GROUP BY c.agent_id`,
    dueTo > p.from
      ? prisma.followUp.findMany({
          where: {
            account_id: accountId,
            due_at: { gte: p.from, lt: dueTo },
            ...(userId ? { OR: [{ assigned_to: userId }, { assigned_to: null, user_id: userId }] } : {}),
          },
          select: { due_at: true, status: true, completed_at: true, assigned_to: true, user_id: true },
          take: FOLLOW_UP_CAP,
        })
      : Promise.resolve([]),
    prisma.leadActivity.findFirst({ where: { account_id: accountId, type: 'call' }, orderBy: { created_at: 'asc' }, select: { created_at: true } }),
    prisma.$queryRaw<Array<{ owner: string | null; minutes: number | null }>>`
      SELECT l.assigned_to::text AS owner,
             EXTRACT(EPOCH FROM (fc.first_at - l.created_at)) / 60 AS minutes
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT a.created_at AS first_at FROM lead_activities a
        WHERE a.lead_id = l.id AND a.account_id = l.account_id AND a.type = 'call'
        ORDER BY a.created_at ASC LIMIT 1
      ) fc ON true
      WHERE l.account_id = ${accountId}::uuid AND l.is_hidden = false AND l.ai_suggested = false
        AND l.created_at >= ${p.from} AND l.created_at < ${p.to} ${ownedByMe}`,
    prisma.$queryRaw<Array<{ id: string; title: string; owner: string | null; days: number }>>`
      SELECT * FROM (
        SELECT l.id::text AS id, l.title, l.assigned_to::text AS owner,
               floor(EXTRACT(EPOCH FROM (${now}::timestamptz - GREATEST(
                 l.created_at,
                 COALESCE(l.last_customer_at, l.created_at),
                 COALESCE((SELECT max(a.created_at) FROM lead_activities a WHERE a.lead_id = l.id AND a.account_id = l.account_id AND a.user_id IS NOT NULL), l.created_at)
               ))) / 86400)::int AS days
        FROM leads l
        WHERE l.account_id = ${accountId}::uuid AND l.status <> 'closed' AND l.is_hidden = false AND l.ai_suggested = false ${ownedByMe}
      ) t
      WHERE t.days >= ${IDLE_MIN_DAYS}::int
      ORDER BY t.days DESC
      LIMIT ${IDLE_ROW_CAP}::int`,
  ])

  const callsByDay = new Map<string, CallSlot>()
  const callsByHour: CallSlot[] = Array.from({ length: 24 }, () => ({ calls: 0, connected: 0 }))
  for (const r of callRows) {
    const total = Number(r.total)
    const connected = Number(r.connected)
    const d = callsByDay.get(r.day) ?? { calls: 0, connected: 0 }
    d.calls += total
    d.connected += connected
    callsByDay.set(r.day, d)
    const h = callsByHour[Number(r.hour)]
    if (h) {
      h.calls += total
      h.connected += connected
    }
  }

  const talk = new Map(talkRows.map((r) => [r.agent_id, { answered: Number(r.answered), seconds: Number(r.secs ?? 0) }]))

  const team = emptyFollowUps()
  const fuBy = new Map<string, FollowUpStats>()
  for (const r of fuRows) {
    addFollowUp(team, r, now)
    const who = r.assigned_to ?? r.user_id
    if (!who) continue
    const s = fuBy.get(who) ?? emptyFollowUps()
    addFollowUp(s, r, now)
    fuBy.set(who, s)
  }

  // Leads from before calls were logged would all read "never called".
  const since = firstLogged?.created_at ?? null
  const counted = since && since.getTime() <= p.to.getTime() ? firstRows : []
  const firstBy = new Map<string, { minutes: number[]; none: number }>()
  for (const r of counted) {
    if (!r.owner) continue
    const e = firstBy.get(r.owner) ?? { minutes: [], none: 0 }
    if (r.minutes == null) e.none += 1
    else e.minutes.push(Math.max(0, Number(r.minutes)))
    firstBy.set(r.owner, e)
  }
  const mins = counted.map((r) => (r.minutes == null ? null : Math.max(0, Number(r.minutes))))

  const idleBuckets: Record<IdleBucket, number> = { d3: 0, d7: 0, d14: 0, d30: 0 }
  const idleBy = new Map<string, number>()
  for (const r of idleRows) {
    const b = idleBucket(Number(r.days))
    if (!b) continue
    idleBuckets[b] += 1
    if (r.owner) idleBy.set(r.owner, (idleBy.get(r.owner) ?? 0) + 1)
  }

  return {
    callsByDay,
    callsByHour,
    talk,
    followUps: { team, byUser: fuBy },
    firstCall: {
      countedSince: since ? since.toISOString().slice(0, 10) : null,
      buckets: firstCallBuckets(mins),
      medianMinutes: median(mins.filter((m): m is number => m != null)),
      byUser: firstBy,
    },
    idle: {
      total: idleRows.length,
      buckets: idleBuckets,
      byUser: idleBy,
      oldest: idleRows.slice(0, 10).map((r) => ({ id: r.id, title: r.title, days: Number(r.days), owner: r.owner })),
    },
  }
}

/** "1 h 25 min" / "12 min" / "40 s". */
export function talkText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
