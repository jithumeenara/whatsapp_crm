/**
 * Showing AI cost in the currency the bill actually arrives in.
 *
 * Google publishes Gemini pricing in USD per million tokens and bills an
 * Indian account in rupees, converting at its own rate on its own date.
 * The price table in usage.ts is therefore in USD, and everything an
 * Indian account looks at should be in rupees.
 *
 * ── What this can and cannot promise ────────────────────────────────
 *
 * It cannot match the Cloud Console to the paisa, and claiming otherwise
 * would be the kind of precision that destroys trust the first time
 * somebody compares the two. Three reasons, none of them fixable here:
 *
 *   - Google converts at its own daily rate. This uses one fixed rate.
 *   - Google meters some things this app never sees, and rounds per SKU
 *     per day rather than per call.
 *   - Published prices change; a local table learns about it later.
 *
 * What it does promise is that the token counts are the vendor's own
 * numbers, and that the rupee figure is those counts at a stated rate —
 * which makes it useful for "which feature is expensive" and "is this
 * month worse than last", the two questions the tab exists to answer.
 * Every surface says "estimated" for exactly this reason.
 *
 * Set USD_INR_RATE in the environment to keep it close to the real rate.
 */

/** Rate as of the date below. Overridable, because the correct value
 *  changes daily and a hardcoded number silently ages. */
const DEFAULT_USD_TO_INR = 88.5
const RATE_AS_OF = '2026-09'

export function usdToInrRate(): number {
  const raw = process.env.USD_INR_RATE
  if (raw) {
    const parsed = Number(raw)
    // A typo here would silently multiply every figure on the Usage tab
    // by nonsense, so an implausible value is ignored rather than used.
    if (Number.isFinite(parsed) && parsed > 1 && parsed < 1000) return parsed
    console.warn(`[ai-usage] ignoring USD_INR_RATE="${raw}" — expected a number between 1 and 1000`)
  }
  return DEFAULT_USD_TO_INR
}

export function usdToInr(usd: number): number {
  return Number((usd * usdToInrRate()).toFixed(4))
}

/** Where the rate came from, so the UI can say so rather than present a
 *  converted figure as if it were billed. */
export function rateNote(): string {
  const rate = usdToInrRate()
  return process.env.USD_INR_RATE
    ? `Converted at ₹${rate}/$ (set on this server).`
    : `Converted at ₹${rate}/$ (default, ${RATE_AS_OF}). Set USD_INR_RATE to match your bill.`
}

/**
 * Rupees, formatted for reading rather than for accounting.
 *
 * A single chat reply costs a few paise, and a month costs a few hundred
 * rupees. One format cannot serve both: ₹0.03 rounds a real cost to zero
 * at two decimals, and ₹326.8100 is noise. So small amounts keep their
 * paise and large ones do not.
 */
export function formatInr(inr: number): string {
  if (!Number.isFinite(inr)) return '₹0'
  if (inr === 0) return '₹0'
  if (inr < 1) return `₹${inr.toFixed(3)}`
  if (inr < 100) return `₹${inr.toFixed(2)}`
  return `₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
