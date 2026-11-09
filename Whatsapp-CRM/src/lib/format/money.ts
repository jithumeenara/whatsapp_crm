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
  // An amount that rounds to nothing is zero, never "-0.00".
  const step = Math.pow(10, -digits)
  const value = Math.abs(amount) < step / 2 ? 0 : amount
  if (!code) return value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  try {
    return new Intl.NumberFormat(numberLocaleFor(code), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  } catch {
    return `${code} ${value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
}

/**
 * A cost that can be tiny: an AI call costs a fraction of a cent, and "$0.00"
 * beside a total that is not zero reads as a mistake. Anything above zero and
 * below the smallest unit is shown as "<$0.01"; a real zero stays zero.
 */
export function formatCost(amount: number, currency: string): string {
  const digits = currencyDigits(String(currency ?? '').trim().toUpperCase())
  const step = Math.pow(10, -digits)
  if (Number.isFinite(amount) && amount > 0 && amount < step / 2) return `<${formatAmount(step, currency)}`
  return formatAmount(amount, currency)
}
