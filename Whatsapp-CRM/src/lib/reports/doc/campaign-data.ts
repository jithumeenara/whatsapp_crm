/**
 * Campaign report data (plan §4.6): every broadcast sent in the period —
 * sent → delivered → read → replied → failed, its WhatsApp cost and cost
 * per reply, and the leads that followed a reply — plus templates (use,
 * cost, quality, rejections) and opt-ins / opt-outs by day.
 *
 * Costs come from whatsapp_message_costs (Meta's own pricing on each
 * delivered message); amounts in another currency are never added in.
 */

import { prisma } from '@/lib/db'
import type { ReportPeriod } from '../period'
import { zoneForSql } from '../summary'

/** A lead counts for a broadcast when it came in within this many days of the message, from someone who replied. */
export const LEAD_WINDOW_DAYS = 7

export interface RawBroadcast { id: string; name: string; template: string; sent: number; delivered: number; read: number; replied: number; failed: number }

export interface BroadcastRow extends RawBroadcast {
  deliveredPct: number | null
  readPct: number | null
  repliedPct: number | null
  /** In the business currency; null when nothing was charged in it. */
  cost: number | null
  /** Part of the cost was charged in another currency (left out). */
  otherCurrency: boolean
  costPerReply: number | null
  leads: number
  won: number
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

export function assembleBroadcasts(
  raw: RawBroadcast[],
  costs: Array<{ id: string; currency: string | null; amount: number }>,
  leads: Array<{ id: string; leads: number; won: number }>,
  currency: string,
): BroadcastRow[] {
  return raw.map((b) => {
    const mine = costs.filter((c) => c.id === b.id)
    const inCur = mine.filter((c) => c.currency === currency)
    const cost = inCur.length ? inCur.reduce((x, c) => x + c.amount, 0) : null
    const l = leads.find((x) => x.id === b.id)
    return {
      ...b,
      deliveredPct: share(b.delivered, b.sent),
      readPct: share(b.read, b.delivered),
      repliedPct: share(b.replied, b.delivered),
      cost,
      otherCurrency: mine.some((c) => c.currency !== currency && c.amount > 0),
      costPerReply: cost != null && b.replied > 0 ? Math.round((cost / b.replied) * 100) / 100 : null,
      leads: l?.leads ?? 0,
      won: l?.won ?? 0,
    }
  }).sort((x, y) => y.sent - x.sent || x.name.localeCompare(y.name))
}

export function totalsOf(rows: BroadcastRow[]) {
  const sum = (f: (r: BroadcastRow) => number) => rows.reduce((x, r) => x + f(r), 0)
  const sent = sum((r) => r.sent)
  const delivered = sum((r) => r.delivered)
  const read = sum((r) => r.read)
  const replied = sum((r) => r.replied)
  const priced = rows.filter((r) => r.cost != null)
  const cost = priced.length ? priced.reduce((x, r) => x + (r.cost ?? 0), 0) : null
  return {
    broadcasts: rows.length, sent, delivered, read, replied, failed: sum((r) => r.failed),
    deliveredPct: share(delivered, sent), readPct: share(read, delivered), repliedPct: share(replied, delivered),
    cost, costPerReply: cost != null && replied > 0 ? Math.round((cost / replied) * 100) / 100 : null,
    leads: sum((r) => r.leads), won: sum((r) => r.won),
  }
}

export interface TemplateRow { name: string; category: string | null; status: string | null; quality: string | null; rejection: string | null; messages: number; cost: number | null }

export async function loadCampaigns(a: { accountId: string; period: ReportPeriod; tz: string; now: Date; currency: string }) {
  const p = a.period
  const zone = await zoneForSql(prisma, a.tz, a.now)
  const n = (v: unknown) => Number(v ?? 0) || 0
  const [raw, costs, leads, tplCost, templates, optOut, optIn] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; template: string; sent: bigint; delivered: bigint; read: bigint; replied: bigint; failed: bigint }>>`
      SELECT b.id::text AS id, b.name, b.template_name AS template,
             count(*) FILTER (WHERE r.sent_at IS NOT NULL) AS sent,
             count(*) FILTER (WHERE r.delivered_at IS NOT NULL) AS delivered,
             count(*) FILTER (WHERE r.read_at IS NOT NULL) AS read,
             count(*) FILTER (WHERE r.replied_at IS NOT NULL) AS replied,
             count(*) FILTER (WHERE r.status = 'failed') AS failed
      FROM broadcast_recipients r JOIN broadcasts b ON b.id = r.broadcast_id
      WHERE b.account_id = ${a.accountId}::uuid
        AND COALESCE(r.sent_at, r.created_at) >= ${p.from} AND COALESCE(r.sent_at, r.created_at) < ${p.to}
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<Array<{ id: string; currency: string | null; amount: unknown }>>`
      SELECT broadcast_id::text AS id, currency, COALESCE(sum(amount) FILTER (WHERE rate_known), 0) AS amount
      FROM whatsapp_message_costs
      WHERE account_id = ${a.accountId}::uuid AND broadcast_id IS NOT NULL AND voided_at IS NULL AND delivered_at IS NOT NULL
        AND occurred_at >= ${p.from} AND occurred_at < ${p.to}
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ id: string; leads: bigint; won: bigint }>>`
      SELECT r.broadcast_id::text AS id, count(DISTINCT l.id) AS leads,
             count(DISTINCT l.id) FILTER (WHERE l.status = 'closed' AND l.converted_at IS NOT NULL) AS won
      FROM broadcast_recipients r
      JOIN broadcasts b ON b.id = r.broadcast_id
      JOIN leads l ON l.contact_id = r.contact_id AND l.account_id = b.account_id AND l.is_hidden = false
        AND l.created_at >= r.sent_at AND l.created_at < r.sent_at + make_interval(days => ${LEAD_WINDOW_DAYS}::int)
      WHERE b.account_id = ${a.accountId}::uuid AND r.replied_at IS NOT NULL AND r.sent_at >= ${p.from} AND r.sent_at < ${p.to}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ name: string; currency: string | null; n: bigint; amount: unknown }>>`
      SELECT template_name AS name, currency, count(*) AS n, COALESCE(sum(amount) FILTER (WHERE rate_known), 0) AS amount
      FROM whatsapp_message_costs
      WHERE account_id = ${a.accountId}::uuid AND template_name IS NOT NULL AND voided_at IS NULL AND delivered_at IS NOT NULL
        AND occurred_at >= ${p.from} AND occurred_at < ${p.to}
      GROUP BY 1, 2`,
    prisma.messageTemplate.findMany({
      where: { account_id: a.accountId, status: { not: 'DRAFT' } },
      select: { name: true, category: true, status: true, quality_score: true, rejection_reason: true },
      take: 300,
    }),
    prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
      SELECT ((opted_out_at AT TIME ZONE ${zone})::date)::text AS day, count(*) AS n FROM contacts
      WHERE account_id = ${a.accountId}::uuid AND opted_out_at >= ${p.from} AND opted_out_at < ${p.to} GROUP BY 1`,
    prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
      SELECT ((opt_in_at AT TIME ZONE ${zone})::date)::text AS day, count(*) AS n FROM contacts
      WHERE account_id = ${a.accountId}::uuid AND opt_in_at >= ${p.from} AND opt_in_at < ${p.to} GROUP BY 1`,
  ])

  const broadcasts = assembleBroadcasts(
    raw.map((r) => ({ id: r.id, name: r.name, template: r.template, sent: n(r.sent), delivered: n(r.delivered), read: n(r.read), replied: n(r.replied), failed: n(r.failed) })),
    costs.map((c) => ({ id: c.id, currency: c.currency, amount: n(c.amount) })),
    leads.map((l) => ({ id: l.id, leads: n(l.leads), won: n(l.won) })),
    a.currency,
  )

  const used = new Map<string, { messages: number; cost: number | null }>()
  for (const t of tplCost) {
    const e = used.get(t.name) ?? { messages: 0, cost: null }
    e.messages += n(t.n)
    if (t.currency === a.currency) e.cost = (e.cost ?? 0) + n(t.amount)
    used.set(t.name, e)
  }
  const known = new Map(templates.map((t) => [t.name, t]))
  const names = new Set([...used.keys(), ...templates.map((t) => t.name)])
  const templateRows: TemplateRow[] = [...names].map((name) => {
    const t = known.get(name)
    const u = used.get(name)
    return { name, category: t?.category ?? null, status: t?.status ?? null, quality: t?.quality_score ?? null, rejection: t?.rejection_reason ?? null, messages: u?.messages ?? 0, cost: u?.cost ?? null }
  }).sort((x, y) => y.messages - x.messages || x.name.localeCompare(y.name))

  return {
    broadcasts,
    totals: totalsOf(broadcasts),
    templates: templateRows,
    optOut: new Map(optOut.map((r) => [r.day, n(r.n)])),
    optIn: new Map(optIn.map((r) => [r.day, n(r.n)])),
  }
}
