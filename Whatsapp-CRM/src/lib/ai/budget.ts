/**
 * A monthly spending limit for the AI.
 *
 * ai_usage_events records what every call cost, but nothing stopped
 * spending: a loop, a burst of spam or a forgotten switch ran up a bill
 * nobody saw until the invoice. A workspace can now set a monthly limit
 * (Settings → AI Config → Usage):
 *
 *   - at 80% the owners and admins are told once that month;
 *   - at 100% automatic customer replies stop and each conversation goes
 *     to the team with a note saying why; they are told once more.
 *
 * Everything else keeps working — people can still reply, and screens
 * that call the AI on a person's click still do. The month is the
 * business's own (its time zone), so the limit resets at midnight on the
 * 1st where the business is, not where the server is.
 *
 * Spend is the same estimate the Usage tab shows (pricing.ts), so the
 * limit and the screen always agree.
 */

import { prisma } from '@/lib/db'
import { businessTimezone } from './human-date'
import { dayKey, dayStartIso } from '@/lib/audit/zoned'
import { formatMoney } from './fx'
import { liveUsdRate } from './fx-live'
import { taxPercentFor } from './cost-display'

export const WARN_RATIO = 0.8
export const MAX_LIMIT_USD = 100_000

export interface BudgetState {
  /** null = no limit set. */
  limitUsd: number | null
  spentUsd: number
  /** 'YYYY-MM' in the business time zone. */
  month: string
  /** spent / limit, 0 when there is no limit. */
  ratio: number
  over: boolean
  /** The currency the limit was set in and 1 USD in it (migration 198);
   *  null on a limit saved before that, which is shown in USD. */
  currency?: string | null
  usdRate?: number | null
  /** The rate follows the market daily (migration 199, fx-live.ts). */
  rateAuto?: boolean
  /** When that live rate was fetched; null when the saved rate is in use. */
  rateFetchedAt?: Date | null
}

/**
 * The rate to convert with: today's live rate when the limit follows the
 * market and one is available, otherwise the rate the admin saved.
 */
export async function effectiveRate(currency: string | null, savedRate: number | null, auto: boolean): Promise<{ rate: number | null; fetchedAt: Date | null }> {
  if (auto && currency) {
    const live = await liveUsdRate(currency)
    // A live rate far (over 3×) from the one last saved is not trusted: a
    // wrong or spoofed answer must not make the limit tiny or endless.
    const plausible = live && (!savedRate || (live.rate > savedRate / 3 && live.rate < savedRate * 3))
    if (live && plausible) return { rate: live.rate, fetchedAt: live.fetchedAt }
  }
  return { rate: savedRate, fetchedAt: null }
}

/** A USD amount in the limit's own currency (USD when it has none). */
export function inLimitCurrency(state: BudgetState, usd: number): { amount: number; currency: string } {
  if (state.currency && state.usdRate && state.usdRate > 0) return { amount: usd * state.usdRate, currency: state.currency }
  return { amount: usd, currency: 'USD' }
}

/** 'YYYY-MM' of `now` in the zone, and the instant that month began. */
export function monthWindow(now: Date, timeZone: string): { month: string; startsAt: Date } {
  const month = dayKey(now, timeZone).slice(0, 7)
  const iso = dayStartIso(`${month}-01`, timeZone)
  return { month, startsAt: iso ? new Date(iso) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) }
}

/** The pure part: what a limit and a spend add up to. */
export function budgetFrom(limitUsd: number | null, spentUsd: number, month: string): BudgetState {
  const limit = limitUsd && limitUsd > 0 ? limitUsd : null
  const ratio = limit ? spentUsd / limit : 0
  return { limitUsd: limit, spentUsd, month, ratio, over: limit !== null && spentUsd >= limit }
}

const TTL_MS = 60_000
const cache = new Map<string, { at: number; state: BudgetState }>()

/** Forget the cached state, after the limit changes. */
export function forgetBudget(accountId: string): void {
  cache.delete(accountId)
}

/**
 * This month's limit and spend. Cached for a minute per workspace, so the
 * sum does not run on every message. Never throws: a failed read (the
 * table not migrated yet, a database blip) means "no limit", because
 * silencing every customer over a lookup error is worse than overspending
 * for a minute.
 */
export async function aiBudgetState(accountId: string, now: Date = new Date()): Promise<BudgetState> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.state
  const timeZone = await businessTimezone(accountId)
  const { month, startsAt } = monthWindow(now, timeZone)
  let state = budgetFrom(null, 0, month)
  try {
    const row = await prisma.aiBudget.findUnique({ where: { account_id: accountId }, select: { monthly_limit_usd: true, warned_month: true, stopped_month: true, currency: true, usd_rate: true, limit_amount: true, rate_auto: true } })
    if (row) {
      const sum = await prisma.aiUsageEvent.aggregate({
        where: { account_id: accountId, created_at: { gte: startsAt } },
        _sum: { cost_usd: true },
      })
      const savedRate = row.usd_rate === null || row.usd_rate === undefined ? null : Number(row.usd_rate)
      const r = await effectiveRate(row.currency ?? null, savedRate, row.rate_auto === true)
      // With an automatic rate the limit stays the amount entered in the
      // business's money, so its USD equivalent follows today's rate.
      const amount = row.limit_amount === null || row.limit_amount === undefined ? null : Number(row.limit_amount)
      const limitUsd = row.rate_auto && amount && r.rate ? amount / r.rate : Number(row.monthly_limit_usd)
      // Spend as billed: the usage price plus the tax on the provider's
      // bill (e.g. 18% GST, Settings → AI Config → Usage; migration 200).
      const tax = await taxPercentFor(accountId)
      const spentUsd = Number(sum._sum.cost_usd ?? 0) * (1 + tax / 100)
      state = {
        ...budgetFrom(limitUsd, spentUsd, month),
        currency: row.currency ?? null,
        usdRate: r.rate,
        rateAuto: row.rate_auto === true,
        rateFetchedAt: r.fetchedAt,
      }
      void tellAdminsIfCrossed(accountId, state, row.warned_month, row.stopped_month)
    }
  } catch (err) {
    console.error('[ai-budget] could not read the limit:', err instanceof Error ? err.message : err)
  }
  cache.set(accountId, { at: Date.now(), state })
  return state
}

/**
 * The 80% and 100% notices, once each per month. The month is claimed
 * with a conditional update first, so two servers or two messages at the
 * same moment send one notice, not two.
 */
async function tellAdminsIfCrossed(accountId: string, state: BudgetState, warned: string | null, stopped: string | null): Promise<void> {
  if (state.limitUsd === null) return
  try {
    const limitIn = inLimitCurrency(state, state.limitUsd)
    const spentIn = inLimitCurrency(state, state.spentUsd)
    const limit = formatMoney(limitIn.amount, limitIn.currency)
    const spent = formatMoney(spentIn.amount, spentIn.currency)
    if (state.over && stopped !== state.month) {
      const claimed = await prisma.aiBudget.updateMany({
        where: { account_id: accountId, OR: [{ stopped_month: null }, { stopped_month: { not: state.month } }] },
        data: { stopped_month: state.month, warned_month: state.month },
      })
      if (claimed.count === 1) {
        await notify(accountId, 'AI budget used up', `This month's AI spend (${spent}) reached the ${limit} limit. Automatic replies are paused and new chats go to your team until the 1st, or until you raise the limit.`)
      }
      return
    }
    if (!state.over && state.ratio >= WARN_RATIO && warned !== state.month) {
      const claimed = await prisma.aiBudget.updateMany({
        where: { account_id: accountId, OR: [{ warned_month: null }, { warned_month: { not: state.month } }] },
        data: { warned_month: state.month },
      })
      if (claimed.count === 1) {
        await notify(accountId, 'AI budget at 80%', `This month's AI spend is ${spent} of your ${limit} limit. At the limit, automatic replies pause and chats go to your team.`)
      }
    }
  } catch (err) {
    console.error('[ai-budget] notice failed:', err instanceof Error ? err.message : err)
  }
}

async function notify(accountId: string, title: string, body: string): Promise<void> {
  const { sendPushToUser } = await import('@/lib/push')
  const people = await prisma.profile.findMany({
    where: { account_id: accountId, account_role: { in: ['owner', 'admin'] } },
    select: { user_id: true },
  })
  await Promise.all(
    people.map((p) => sendPushToUser(p.user_id, { title, body, tag: 'ai-budget', data: { url: '/settings?tab=ai' } }).catch(() => {})),
  )
}

/** The note left on a conversation the assistant did not answer because
 *  the limit was reached. */
export const BUDGET_HANDOVER_NOTE =
  "The assistant did not answer: this month's AI budget is used up. Please reply to this customer yourself. An admin can raise the limit in Settings → AI Config → Usage."
