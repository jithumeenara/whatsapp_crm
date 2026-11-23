/**
 * How many of a currency one US dollar is worth — a SUGGESTION for the AI
 * spending limit (budget.ts), which an admin confirms or edits.
 *
 * AI providers bill in USD; a business thinks in its own currency
 * (accounts.default_currency). These are approximate rates for the
 * currencies the app offers (src/lib/currency.ts), not a live feed: the
 * screen shows the rate in use and lets the admin change it to match their
 * bill, and the rate they save is the one used. INR follows USD_INR_RATE
 * (currency.ts) like the Usage tab, so both agree.
 */

import { usdToInrRate } from './currency'

export const SUGGESTED_RATES_AS_OF = '2026-11'

const APPROX_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  AUD: 1.52,
  CAD: 1.38,
  BRL: 5.4,
  JPY: 150,
  CNY: 7.2,
  AED: 3.6725, // pegged
  ZAR: 18.2,
  NGN: 1500,
  SGD: 1.34,
  MXN: 18.5,
}

/** A suggested rate, or null when there is none to offer (the admin enters one). */
export function suggestedUsdRate(currency: string | null | undefined): number | null {
  const code = (currency ?? '').trim().toUpperCase()
  if (code === 'INR') return usdToInrRate()
  return APPROX_PER_USD[code] ?? null
}

/** A currency code the database accepts (3 capital letters), or USD. */
export function cleanCurrency(code: string | null | undefined): string {
  const c = (code ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(c) ? c : 'USD'
}

/** Money for messages and the card, in the business's currency. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: amount < 10 ? 2 : 0 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}
