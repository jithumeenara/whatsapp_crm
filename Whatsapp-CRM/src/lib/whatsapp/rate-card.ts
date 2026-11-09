/**
 * What WhatsApp charges for one delivered message, from Meta's own rate card.
 *
 * The webhook tells us the CATEGORY and TYPE of a charge for each message,
 * never its price. The price is category x market x the card in force, so it
 * is worked out here from the card Meta published (rate-card-data.ts, generated
 * from Meta's file) and stored with the row, together with which card it came
 * from. History is never repriced from today's card.
 *
 * Three honesty rules:
 *  - Only a card Meta actually published is used. Meta bills each WhatsApp
 *    account in one currency, fixed when it was created; we hold the INR card
 *    only, so any other currency is "no rate card", never a conversion.
 *  - A message from before a card took effect is not priced with it.
 *  - A category we do not recognise is recorded as unknown, not guessed.
 *
 * Pure: no database and no next/server, so the webhook can use it freely.
 */
import { CALLING_PREFIXES, INR_CARD_EFFECTIVE_FROM, INR_RATES, type MarketRates } from './rate-card-data'

export interface RateCard {
  currency: string
  /** First day (YYYY-MM-DD, UTC) this card applies. */
  effectiveFrom: string
  rates: Record<string, MarketRates>
}

const CARDS: Record<string, RateCard> = {
  INR: { currency: 'INR', effectiveFrom: INR_CARD_EFFECTIVE_FROM, rates: INR_RATES },
}

/** Meta's card for a billing currency, or null when we hold none. */
export function rateCardFor(currency: string | null | undefined): RateCard | null {
  const key = (currency ?? '').trim().toUpperCase()
  return CARDS[key] ?? null
}

// Longest prefix first, so +1 809 (Dominican Republic) wins over +1 and
// +7 76/77 (Kazakhstan) over +7.
const PREFIXES = [...CALLING_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length)

/** The market Meta prices a recipient in, from their number. */
export function marketForNumber(recipient: string | null | undefined): { market: string; iso: string | null } {
  let digits = String(recipient ?? '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (!digits) return { market: 'Other', iso: null }
  for (const p of PREFIXES) {
    if (digits.startsWith(p.prefix)) return { market: p.market, iso: p.iso }
  }
  return { market: 'Other', iso: null }
}

const FREE_TYPES = new Set(['free_customer_service', 'free_entry_point', 'free_group_customer_service'])

export interface PriceInput {
  /** The business's WhatsApp billing currency. */
  currency: string | null | undefined
  /** Recipient number (wa_id). */
  recipient: string | null | undefined
  /** pricing.category from the status webhook. */
  category: string | null | undefined
  /** pricing.type from the status webhook ("regular" or a free type). */
  type: string | null | undefined
  /** When the message was delivered (or sent). */
  at: Date
}

export interface Priced {
  /** Decimal string with six places, or null when no honest price exists. */
  amount: string | null
  /** True when the amount (including a free 0) is Meta's published figure. */
  rateKnown: boolean
  market: string
  iso: string | null
  currency: string | null
  /** Which card the figure came from, e.g. "INR 2026-10-01". Null when none. */
  rateVersion: string | null
}

const six = (n: number) => n.toFixed(6)

export function priceMessage(input: PriceInput): Priced {
  const { market, iso } = marketForNumber(input.recipient)
  return priceInMarket({ ...input, market, iso })
}

/** The same price for a market already known (a stored cost row keeps its market, not the number). */
export function priceInMarket(input: Omit<PriceInput, 'recipient'> & { market: string; iso: string | null }): Priced {
  const { market, iso } = input
  const card = rateCardFor(input.currency)
  const unknown: Priced = {
    amount: null, rateKnown: false, market, iso,
    currency: card?.currency ?? (input.currency ? input.currency.trim().toUpperCase() : null),
    rateVersion: null,
  }
  if (!card) return unknown
  if (input.at.toISOString().slice(0, 10) < card.effectiveFrom) return unknown

  const version = `${card.currency} ${card.effectiveFrom}`
  const free: Priced = { amount: six(0), rateKnown: true, market, iso, currency: card.currency, rateVersion: version }

  const type = (input.type ?? '').toLowerCase()
  const category = (input.category ?? '').toLowerCase()
  if (FREE_TYPES.has(type) || category === 'referral_conversion') return free
  if (type && type !== 'regular') return unknown

  const rates = card.rates[market] ?? card.rates.Other
  if (!rates) return unknown
  let rate: number | null | undefined
  switch (category) {
    case 'marketing': rate = rates.marketing; break
    case 'utility': rate = rates.utility; break
    case 'authentication': rate = rates.authentication; break
    case 'authentication-international':
    case 'authentication_international': rate = rates.authenticationInternational; break
    case 'service': rate = rates.service; break
    default: rate = undefined
  }
  if (rate === null || rate === undefined) return unknown
  return { amount: six(rate), rateKnown: true, market, iso, currency: card.currency, rateVersion: version }
}
