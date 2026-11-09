import { currencyDigits } from '@/lib/countries'

/**
 * An amount of money for people to read: the decimals the currency really
 * has (INR and USD 2, JPY 0, KWD 3) and the number grouping of where it is
 * used (₹12,34,567.50 for rupees). Never a browser default: the same report
 * must read the same on every machine.
 *
 * The existing formatMoney in reports/headline.ts rounds to whole units,
 * which is right for a deal's value and wrong for what one message costs.
 */
export function numberLocaleFor(currency: string): string {
  return currency.toUpperCase() === 'INR' ? 'en-IN' : 'en'
}

export function formatAmount(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—'
  const code = String(currency ?? '').trim().toUpperCase()
  const digits = currencyDigits(code)
  try {
    return new Intl.NumberFormat(numberLocaleFor(code), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    return `${code} ${amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
}
