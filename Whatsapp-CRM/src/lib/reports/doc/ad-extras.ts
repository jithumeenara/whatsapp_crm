/**
 * What the Ad report adds on top of src/lib/ads/performance.ts (plan §4.3):
 * which team member won the leads from which ad, where the ad was seen,
 * people arriving from ads by day and by weekday.
 *
 * Meta rules this follows (docs/plans/reports-sections-plan.md §5):
 * - Facebook or Instagram is said only when Meta's referral says so.
 * - A WhatsApp ad click without a click id (ctwa_clid) came from a
 *   WhatsApp Status ad.
 */

import { prisma } from '@/lib/db'
import type { ReportPeriod } from '../period'
import { zoneForSql } from '../summary'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MIN_LEADS = 10

export function placeOf(t: { channel: string; platform: string | null; click_id: string | null }): string {
  if (t.platform === 'facebook') return 'Facebook'
  if (t.platform === 'instagram') return 'Instagram'
  if (t.channel === 'whatsapp' && !t.click_id) return 'WhatsApp Status'
  return 'Not known'
}

export interface WeekdayRow { day: string; arrivals: number; leads: number; won: number; wonPct: number | null }

/** Monday first, every day present; won % only from enough leads. Pure. */
export function weekdayRows(arrivals: Array<{ dow: number; n: number }>, leads: Array<{ dow: number; leads: number; won: number }>): WeekdayRow[] {
  return [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const a = arrivals.find((x) => x.dow === dow)?.n ?? 0
    const l = leads.find((x) => x.dow === dow)
    const n = l?.leads ?? 0
    const w = l?.won ?? 0
    return { day: DAYS[dow], arrivals: a, leads: n, won: w, wonPct: n >= MIN_LEADS ? Math.round((w / n) * 1000) / 10 : null }
  })
}

export interface AdExtras {
  byAgent: Array<{ adId: string; owner: string | null; leads: number; won: number }>
  places: Array<{ place: string; arrivals: number }>
  arrivalsByDay: Map<string, number>
  weekdays: WeekdayRow[]
}

export async function loadAdExtras(a: { accountId: string; period: ReportPeriod; tz: string; now: Date }): Promise<AdExtras> {
  const p = a.period
  const zone = await zoneForSql(prisma, a.tz, a.now)
  const [agentRows, touchRows, dayRows, dowTouch, dowLeads] = await Promise.all([
    prisma.$queryRaw<Array<{ ad_id: string; owner: string | null; leads: bigint; won: bigint }>>`
      SELECT l.ad_id, COALESCE(l.closed_by, l.assigned_to)::text AS owner, count(*) AS leads,
             count(*) FILTER (WHERE l.status = 'closed' AND l.converted_at IS NOT NULL) AS won
      FROM leads l
      WHERE l.account_id = ${a.accountId}::uuid AND l.ad_id IS NOT NULL AND l.is_hidden = false AND l.ai_suggested = false
        AND l.created_at >= ${p.from} AND l.created_at < ${p.to}
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ channel: string; platform: string | null; status_ad: boolean; n: bigint }>>`
      SELECT t.channel, t.platform, (t.click_id IS NULL) AS status_ad, count(*) AS n
      FROM ad_touches t
      WHERE t.account_id = ${a.accountId}::uuid AND t.ad_id IS NOT NULL AND t.touched_at >= ${p.from} AND t.touched_at < ${p.to}
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
      SELECT ((t.touched_at AT TIME ZONE ${zone})::date)::text AS day, count(*) AS n
      FROM ad_touches t
      WHERE t.account_id = ${a.accountId}::uuid AND t.ad_id IS NOT NULL AND t.touched_at >= ${p.from} AND t.touched_at < ${p.to}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ dow: number; n: bigint }>>`
      SELECT EXTRACT(dow FROM (t.touched_at AT TIME ZONE ${zone}))::int AS dow, count(*) AS n
      FROM ad_touches t
      WHERE t.account_id = ${a.accountId}::uuid AND t.ad_id IS NOT NULL AND t.touched_at >= ${p.from} AND t.touched_at < ${p.to}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ dow: number; leads: bigint; won: bigint }>>`
      SELECT EXTRACT(dow FROM (l.created_at AT TIME ZONE ${zone}))::int AS dow, count(*) AS leads,
             count(*) FILTER (WHERE l.status = 'closed' AND l.converted_at IS NOT NULL) AS won
      FROM leads l
      WHERE l.account_id = ${a.accountId}::uuid AND l.ad_id IS NOT NULL AND l.is_hidden = false AND l.ai_suggested = false
        AND l.created_at >= ${p.from} AND l.created_at < ${p.to}
      GROUP BY 1`,
  ])
  const places = new Map<string, number>()
  for (const r of touchRows) {
    const place = placeOf({ channel: r.channel, platform: r.platform, click_id: r.status_ad ? null : 'x' })
    places.set(place, (places.get(place) ?? 0) + Number(r.n))
  }
  return {
    byAgent: agentRows.map((r) => ({ adId: r.ad_id, owner: r.owner, leads: Number(r.leads), won: Number(r.won) })),
    places: [...places.entries()].map(([place, arrivals]) => ({ place, arrivals })).sort((x, y) => y.arrivals - x.arrivals),
    arrivalsByDay: new Map(dayRows.map((r) => [r.day, Number(r.n)])),
    weekdays: weekdayRows(dowTouch.map((r) => ({ dow: Number(r.dow), n: Number(r.n) })), dowLeads.map((r) => ({ dow: Number(r.dow), leads: Number(r.leads), won: Number(r.won) }))),
  }
}
