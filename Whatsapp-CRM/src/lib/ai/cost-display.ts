/**
 * How an AI cost is shown to a business: in its own currency
 * (accounts.default_currency), at today's rate, with the tax its provider
 * bill carries (migration 200). Stored costs stay the estimated usage
 * price in USD (ai_usage_events); this is applied only when showing them
 * (Usage tab) and comparing them with the monthly AI limit (budget.ts),
 * so both read like the bill.
 */

import { prisma } from '@/lib/db'
import { cleanCurrency, suggestedUsdRate } from './fx'
import { liveUsdRate } from './fx-live'

export interface CostDisplay {
  currency: string
  /** 1 USD in `currency`; null when no rate is known (shown in USD). */
  rate: number | null
  rateSource: 'live' | 'suggested' | 'none'
  rateFetchedAt: Date | null
  /** 0–100, e.g. 18 for India's GST. */
  taxPercent: number
}

/** A tax % as saved: a number from 0 to 100 with at most 2 decimals, or null. */
export function cleanTaxPercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null // at most 2 decimals
  return Math.round(n * 100) / 100
}

/** USD usage price → what the business pays, in its currency, tax included. */
export function toDisplayAmount(usd: number, d: Pick<CostDisplay, 'rate' | 'taxPercent'>): number {
  const withTax = usd * (1 + d.taxPercent / 100)
  return d.rate ? withTax * d.rate : withTax
}

/** The workspace's tax %, 0 when none is set or the table is not there yet. */
export async function taxPercentFor(accountId: string): Promise<number> {
  try {
    const row = await prisma.aiCostSettings.findUnique({ where: { account_id: accountId }, select: { tax_percent: true } })
    const n = row ? Number(row.tax_percent) : 0
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0
  } catch {
    return 0
  }
}

/** Never throws: a failed lookup shows costs in USD without tax rather
 *  than breaking the Usage tab. */
export async function costDisplayFor(accountId: string): Promise<CostDisplay> {
  let currency = 'USD'
  let taxPercent = 0
  let live: { rate: number; fetchedAt: Date } | null = null
  try {
    const [account, tax] = await Promise.all([
      prisma.account.findUnique({ where: { id: accountId }, select: { default_currency: true } }),
      taxPercentFor(accountId),
    ])
    currency = cleanCurrency(account?.default_currency)
    taxPercent = tax
    live = await liveUsdRate(currency)
  } catch (err) {
    console.error('[cost-display] falling back to USD:', err instanceof Error ? err.message : err)
  }
  if (live) return { currency, rate: live.rate, rateSource: 'live', rateFetchedAt: live.fetchedAt, taxPercent }
  const suggested = suggestedUsdRate(currency)
  if (suggested) return { currency, rate: suggested, rateSource: 'suggested', rateFetchedAt: null, taxPercent }
  return { currency: 'USD', rate: null, rateSource: 'none', rateFetchedAt: null, taxPercent }
}
