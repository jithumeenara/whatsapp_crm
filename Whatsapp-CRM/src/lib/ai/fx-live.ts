/**
 * Today's USD exchange rate, for an AI limit set to follow the market
 * (ai_budgets.rate_auto, budget.ts).
 *
 * Source: open.er-api.com (ExchangeRate-API's open endpoint: free, no key,
 * updated daily, every currency the app offers). The request carries only
 * the word "USD" — nothing about the business or its customers.
 *
 * Fetched at most every 12 hours per server and kept in memory. Never
 * throws and never makes a reply wait long: on a failure, a timeout or a
 * number that is not believable (more than 3× away from the suggested
 * rate) the last good rate is used, then the suggested one (fx.ts).
 */

import { suggestedUsdRate } from './fx'

const SOURCE_URL = 'https://open.er-api.com/v6/latest/USD'
const TTL_MS = 12 * 60 * 60 * 1000
const FAIL_RETRY_MS = 30 * 60 * 1000
const TIMEOUT_MS = 8_000

let rates: Record<string, number> | null = null
let fetchedAt = 0
let lastAttempt = 0
let inFlight: Promise<void> | null = null

/** Rates from the source's JSON, or null when it is not the shape expected. */
export function parseRates(body: unknown): Record<string, number> | null {
  const o = body && typeof body === 'object' ? (body as { result?: unknown; base_code?: unknown; rates?: unknown }) : null
  if (!o || o.result !== 'success' || o.base_code !== 'USD' || !o.rates || typeof o.rates !== 'object') return null
  const out: Record<string, number> = {}
  for (const [code, v] of Object.entries(o.rates as Record<string, unknown>)) {
    if (/^[A-Z]{3}$/.test(code) && typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1_000_000) out[code] = v
  }
  return out.USD === 1 ? out : null
}

/** A live rate is used only when it is believable next to the suggested one. */
export function believable(currency: string, rate: number): boolean {
  const ref = suggestedUsdRate(currency)
  if (!ref) return rate > 0 && rate < 1_000_000
  return rate > ref / 3 && rate < ref * 3
}

async function refresh(): Promise<void> {
  lastAttempt = Date.now()
  try {
    const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const parsed = parseRates(await res.json())
    if (!parsed) throw new Error('unexpected response')
    rates = parsed
    fetchedAt = Date.now()
  } catch (err) {
    console.error('[fx] could not fetch exchange rates, keeping the last ones:', err instanceof Error ? err.message : err)
  }
}

/**
 * Today's rate for a currency (1 USD = rate) and when it was fetched, or
 * null when no believable live rate is available yet.
 */
export async function liveUsdRate(currency: string): Promise<{ rate: number; fetchedAt: Date } | null> {
  const code = currency.trim().toUpperCase()
  if (code === 'USD') return { rate: 1, fetchedAt: new Date() }
  const stale = Date.now() - fetchedAt > TTL_MS
  const mayRetry = Date.now() - lastAttempt > (rates ? TTL_MS : FAIL_RETRY_MS)
  if (stale && mayRetry && !inFlight) {
    inFlight = refresh().finally(() => { inFlight = null })
  }
  if (inFlight && !rates) await inFlight
  const r = rates?.[code]
  return r && believable(code, r) ? { rate: r, fetchedAt: new Date(fetchedAt) } : null
}

/** For tests. */
export function resetLiveRatesForTests(): void {
  rates = null
  fetchedAt = 0
  lastAttempt = 0
  inFlight = null
}
