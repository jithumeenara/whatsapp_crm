/**
 * Reads what the business spent on WhatsApp messages, AI and Meta Ads in a
 * period, and hands the rows to assembleSpending (spending-assemble.ts),
 * which does the arithmetic.
 *
 * Every query is scoped by account_id and cuts days in the business's own
 * time zone. A section that cannot be read (a server where migration 159
 * has not been applied, Meta not answering) is empty and named in
 * `warnings`; the rest of the report still shows.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchAdAccountInsights } from '@/lib/meta-ads/api'
import { usdToInrRate } from '@/lib/ai/currency'
import type { ReportPeriod } from './period'
import { zoneForSql } from './summary'
import { assembleSpending, type SpendingRows } from './spending-assemble'

const n = (v: unknown) => Number(v ?? 0) || 0

async function whatsappRows(accountId: string, period: ReportPeriod, zone: Prisma.Sql) {
  const where = Prisma.sql`account_id = ${accountId}::uuid AND voided_at IS NULL AND occurred_at >= ${period.from} AND occurred_at < ${period.to}`
  const charged = Prisma.sql`${where} AND delivered_at IS NOT NULL`
  const [category, number, person, day, pending] = await Promise.all([
    prisma.$queryRaw<Array<{ category: string | null; type: string | null; currency: string | null; n: bigint; amount: Prisma.Decimal | null; unpriced: bigint }>>(Prisma.sql`
      SELECT pricing_category AS category, pricing_type AS type, currency,
             count(*) AS n,
             COALESCE(sum(amount) FILTER (WHERE rate_known), 0) AS amount,
             count(*) FILTER (WHERE NOT rate_known) AS unpriced
      FROM whatsapp_message_costs WHERE ${charged} GROUP BY 1, 2, 3`),
    prisma.$queryRaw<Array<{ id: string | null; currency: string | null; n: bigint; amount: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT whatsapp_config_id::text AS id, currency, count(*) AS n,
             COALESCE(sum(amount) FILTER (WHERE rate_known), 0) AS amount
      FROM whatsapp_message_costs WHERE ${charged} GROUP BY 1, 2`),
    prisma.$queryRaw<Array<{ user_id: string | null; sender_type: string | null; currency: string | null; n: bigint; amount: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT sender_user_id::text AS user_id, sender_type, currency, count(*) AS n,
             COALESCE(sum(amount) FILTER (WHERE rate_known), 0) AS amount
      FROM whatsapp_message_costs WHERE ${charged} GROUP BY 1, 2, 3`),
    prisma.$queryRaw<Array<{ day: string; currency: string | null; amount: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT (date_trunc('day', occurred_at AT TIME ZONE ${zone}))::date::text AS day, currency,
             COALESCE(sum(amount) FILTER (WHERE rate_known), 0) AS amount
      FROM whatsapp_message_costs WHERE ${charged} GROUP BY 1, 2 ORDER BY 1`),
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT count(*) AS n FROM whatsapp_message_costs WHERE ${where} AND delivered_at IS NULL`),
  ])
  return {
    waCategory: category.map((r) => ({ category: r.category, type: r.type, currency: r.currency, n: n(r.n), amount: n(r.amount), unpriced: n(r.unpriced) })),
    waNumber: number.map((r) => ({ id: r.id, currency: r.currency, n: n(r.n), amount: n(r.amount) })),
    waPerson: person.map((r) => ({ userId: r.user_id, senderType: r.sender_type, currency: r.currency, n: n(r.n), amount: n(r.amount) })),
    waDay: day.map((r) => ({ day: r.day, currency: r.currency, amount: n(r.amount) })),
    waPending: n(pending[0]?.n),
  }
}

async function aiRows(accountId: string, period: ReportPeriod, zone: Prisma.Sql) {
  const where = Prisma.sql`account_id = ${accountId}::uuid AND created_at >= ${period.from} AND created_at < ${period.to}`
  const [feature, channel, person, day] = await Promise.all([
    prisma.$queryRaw<Array<{ feature: string; calls: bigint; cost: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT feature, count(*) AS calls, COALESCE(sum(cost_usd), 0) AS cost
      FROM ai_usage_events WHERE ${where} GROUP BY 1`),
    prisma.$queryRaw<Array<{ channel: string | null; calls: bigint; cost: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT channel, count(*) AS calls, COALESCE(sum(cost_usd), 0) AS cost
      FROM ai_usage_events WHERE ${where} GROUP BY 1`),
    prisma.$queryRaw<Array<{ user_id: string | null; calls: bigint; cost: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT user_id::text AS user_id, count(*) AS calls, COALESCE(sum(cost_usd), 0) AS cost
      FROM ai_usage_events WHERE ${where} GROUP BY 1`),
    prisma.$queryRaw<Array<{ day: string; cost: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT (date_trunc('day', created_at AT TIME ZONE ${zone}))::date::text AS day,
             COALESCE(sum(cost_usd), 0) AS cost
      FROM ai_usage_events WHERE ${where} GROUP BY 1 ORDER BY 1`),
  ])
  return {
    aiFeature: feature.map((r) => ({ feature: r.feature, calls: n(r.calls), costUsd: n(r.cost) })),
    aiChannel: channel.map((r) => ({ channel: r.channel, calls: n(r.calls), costUsd: n(r.cost) })),
    aiPerson: person.map((r) => ({ userId: r.user_id, calls: n(r.calls), costUsd: n(r.cost) })),
    aiDay: day.map((r) => ({ day: r.day, costUsd: n(r.cost) })),
  }
}

async function adsRow(accountId: string, period: ReportPeriod): Promise<SpendingRows['ads']> {
  const none = { connected: false, spend: null, currency: null, clicks: 0, impressions: 0, error: null }
  const config = await prisma.metaAdsConfig.findUnique({ where: { account_id: accountId } })
  if (!config || config.status !== 'connected' || !config.ad_account_id) return none
  try {
    const insights = await fetchAdAccountInsights({
      adAccountId: config.ad_account_id,
      accessToken: decrypt(config.access_token),
      timeRange: { since: period.firstDay, until: period.lastDay },
    })
    // No row from Meta means no spend on those days, which is a real zero.
    return {
      connected: true,
      spend: insights?.spend ?? 0,
      currency: insights?.currency ?? null,
      clicks: insights?.clicks ?? 0,
      impressions: insights?.impressions ?? 0,
      error: null,
    }
  } catch (err) {
    // Meta's own words stay in the server log; the screen gets a sentence.
    console.error('[spending] ad spend failed:', err instanceof Error ? err.message : err)
    return { connected: true, spend: null, currency: null, clicks: 0, impressions: 0, error: 'Could not read ad spend from Meta. Check the ad account and its access in Ads settings.' }
  }
}

export async function loadSpending(args: { accountId: string; period: ReportPeriod; tz: string }) {
  const { accountId, period, tz } = args
  const warnings: string[] = []
  const zone = await zoneForSql(prisma, tz)

  const [account, members, configs, teams, ads, leads, wonDeals] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { default_currency: true } }),
    prisma.profile.findMany({ where: { account_id: accountId }, select: { user_id: true, full_name: true, email: true } }),
    prisma.whatsAppConfig.findMany({ where: { account_id: accountId }, select: { id: true, label: true } }),
    prisma.memberTeam.findMany({ where: { account_id: accountId }, select: { user_id: true, team: true } }).catch(() => []),
    adsRow(accountId, period),
    prisma.lead.count({ where: { account_id: accountId, created_at: { gte: period.from, lt: period.to }, is_hidden: false, ai_suggested: false } }),
    prisma.deal.count({ where: { account_id: accountId, won_at: { gte: period.from, lt: period.to } } }),
  ])

  let wa: Awaited<ReturnType<typeof whatsappRows>> = { waCategory: [], waNumber: [], waPerson: [], waDay: [], waPending: 0 }
  let ai: Awaited<ReturnType<typeof aiRows>> = { aiFeature: [], aiChannel: [], aiPerson: [], aiDay: [] }
  try {
    wa = await whatsappRows(accountId, period, zone)
  } catch (err) {
    console.error('[spending] whatsapp costs unavailable:', err instanceof Error ? err.message : err)
    warnings.push('WhatsApp message costs are not available on this server yet.')
  }
  try {
    ai = await aiRows(accountId, period, zone)
  } catch (err) {
    console.error('[spending] ai costs unavailable:', err instanceof Error ? err.message : err)
    warnings.push('AI costs could not be read.')
  }

  const people: Record<string, string> = {}
  for (const m of members) people[m.user_id] = m.full_name?.trim() || m.email.split('@')[0]
  const numbers: Record<string, string> = {}
  for (const c of configs) numbers[c.id] = c.label?.trim() || 'WhatsApp number'
  const teamMap: Record<string, string> = {}
  for (const t of teams) teamMap[t.user_id] = t.team

  const report = assembleSpending({
    ...wa,
    ...ai,
    numbers,
    people,
    teams: teamMap,
    ads,
    leads,
    wonDeals,
    businessCurrency: account?.default_currency || 'USD',
    usdRate: usdToInrRate(),
  })

  if (wa.waPending > 0) warnings.push(`${wa.waPending} messages are sent but not yet delivered, so they are not counted yet.`)
  if (report.whatsapp.unpriced > 0) {
    warnings.push(`${report.whatsapp.unpriced} messages have no price: set the business currency in Settings, or their date is before Meta's current rate card.`)
  }
  return { ...report, warnings }
}
