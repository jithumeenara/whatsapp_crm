/**
 * Reply speed × win (reports plan, Phase 1 item 7): "of the leads first
 * answered within 5 minutes, X% were won" — from the business's own
 * leads, never an outside benchmark.
 *
 * First contact = the earlier of a person's first WhatsApp reply
 * (leads.first_response_at, stamped only for hand-sent messages) and a
 * person's first logged call on the lead. A business that phones its
 * leads is measured as fairly as one that chats. Bots, AI replies and
 * broadcasts never count (they do not stamp, and their calls have no
 * person).
 *
 * Old leads have no stamp, and guessing would call them "never answered"
 * (plan rule 8). So only leads created since the first stamp or call in
 * this account count, and the screen says from when.
 *
 * Who sees what: an agent's report passes their own id and gets only the
 * leads assigned to them; the caller decides that from the role.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type SpeedBucket = 'min5' | 'hour1' | 'day1' | 'later' | 'none'

export interface SpeedRow {
  bucket: SpeedBucket
  leads: number
  won: number
  /** Whole percent; null when too few leads to mean anything. */
  winRate: number | null
}

export interface ReplySpeed {
  countedSince: string | null
  rows: SpeedRow[]
}

/** Below this many leads a bucket's percent is not shown. */
export const MIN_LEADS_FOR_RATE = 10

const ORDER: SpeedBucket[] = ['min5', 'hour1', 'day1', 'later', 'none']

type Db = Pick<typeof prisma, '$queryRaw'>

interface RawRow { bucket: string; leads: bigint | number; won: bigint | number }

/** Fills missing buckets and works out the win rate. */
export function speedRows(raw: RawRow[]): SpeedRow[] {
  const by = new Map(raw.map((r) => [r.bucket, r]))
  return ORDER.map((bucket) => {
    const r = by.get(bucket)
    const leads = Number(r?.leads ?? 0)
    const won = Number(r?.won ?? 0)
    return { bucket, leads, won, winRate: leads >= MIN_LEADS_FOR_RATE ? Math.round((won / leads) * 100) : null }
  })
}

export async function replySpeed(args: {
  accountId: string
  userId: string | null
  from: Date
  to: Date
  db?: Db
}): Promise<ReplySpeed> {
  const db = args.db ?? prisma
  const mine = args.userId ? Prisma.sql`AND l.assigned_to = ${args.userId}::uuid` : Prisma.empty

  // When this account's measuring began: its first stamped reply or person's call.
  const start = await db.$queryRaw<Array<{ since: Date | null }>>`
    SELECT LEAST(
      (SELECT min(first_response_at) FROM leads WHERE account_id = ${args.accountId}::uuid),
      (SELECT min(created_at) FROM lead_activities
        WHERE account_id = ${args.accountId}::uuid AND type = 'call' AND user_id IS NOT NULL AND lead_id IS NOT NULL)
    ) AS since`
  const since = start[0]?.since ?? null
  if (!since) return { countedSince: null, rows: speedRows([]) }
  const from = since > args.from ? since : args.from
  if (from >= args.to) return { countedSince: since.toISOString(), rows: speedRows([]) }

  const raw = await db.$queryRaw<RawRow[]>`
    WITH c AS (
      SELECT l.created_at, l.status, l.converted_at,
        LEAST(
          l.first_response_at,
          (SELECT min(a.created_at) FROM lead_activities a
            WHERE a.lead_id = l.id AND a.account_id = l.account_id AND a.type = 'call' AND a.user_id IS NOT NULL
              AND a.created_at >= l.created_at)
        ) AS first_touch
      FROM leads l
      WHERE l.account_id = ${args.accountId}::uuid AND l.is_hidden = false AND l.ai_suggested = false
        AND l.created_at >= ${from} AND l.created_at < ${args.to}
        ${mine}
    )
    SELECT
      CASE
        WHEN first_touch IS NULL THEN 'none'
        WHEN first_touch - created_at <= interval '5 minutes' THEN 'min5'
        WHEN first_touch - created_at <= interval '1 hour' THEN 'hour1'
        WHEN first_touch - created_at <= interval '1 day' THEN 'day1'
        ELSE 'later'
      END AS bucket,
      count(*) AS leads,
      count(*) FILTER (WHERE status = 'closed' AND converted_at IS NOT NULL) AS won
    FROM c GROUP BY 1`
  return { countedSince: since.toISOString(), rows: speedRows(raw) }
}

/**
 * One plain sentence comparing fast and slow first contact, written by
 * code, not AI. Null unless both sides have enough leads to compare.
 */
export function speedFinding(rows: SpeedRow[]): string | null {
  const fast = rows.find((r) => r.bucket === 'min5')
  const slow = rows.filter((r) => r.bucket === 'hour1' || r.bucket === 'day1' || r.bucket === 'later')
  const slowLeads = slow.reduce((s, r) => s + r.leads, 0)
  const slowWon = slow.reduce((s, r) => s + r.won, 0)
  if (!fast || fast.leads < MIN_LEADS_FOR_RATE || slowLeads < MIN_LEADS_FOR_RATE) return null
  const a = Math.round((fast.won / fast.leads) * 100)
  const b = Math.round((slowWon / slowLeads) * 100)
  if (a === b) return `Leads answered within 5 minutes were won as often as slower ones (${a}%).`
  return `Leads answered within 5 minutes were won ${a}% of the time, against ${b}% when the first answer took longer.`
}
