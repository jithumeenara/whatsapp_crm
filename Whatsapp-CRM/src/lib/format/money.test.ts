import { describe, expect, it } from 'vitest'
import { formatAmount, numberLocaleFor } from './money'

// Intl uses a no-break space between the symbol and the digits in some
// locales; compare without caring which kind of space it is.
const plain = (s: string) => s.replace(/\s/g, ' ')

describe('formatAmount', () => {
  it('keeps the paise of a rupee amount: a message costs 86 paise, not zero', () => {
    expect(plain(formatAmount(0.8631, 'INR'))).toBe('₹0.86')
    expect(plain(formatAmount(0.115, 'INR'))).toBe('₹0.12')
  })

  it('groups rupees the Indian way', () => {
    expect(plain(formatAmount(1234567.5, 'INR'))).toBe('₹12,34,567.50')
  })

  it('uses the decimals each currency really has', () => {
    expect(plain(formatAmount(1234, 'JPY'))).toBe('¥1,234')
    expect(plain(formatAmount(1.2345, 'KWD'))).toMatch(/1\.235$/)
    expect(plain(formatAmount(5, 'USD'))).toBe('$5.00')
  })

  it('shows a code it does not know as the code and the number, never throws', () => {
    expect(formatAmount(5, 'NOT-REAL')).toBe('NOT-REAL 5.00')
    expect(formatAmount(Number.NaN, 'INR')).toBe('—')
  })

  it('shows a negative amount with its sign', () => {
    expect(plain(formatAmount(-3, 'USD'))).toMatch(/-\$3\.00|\$-3\.00/)
  })
})

describe('numberLocaleFor', () => {
  it('uses lakh grouping for rupees and a neutral locale otherwise', () => {
    expect(numberLocaleFor('INR')).toBe('en-IN')
    expect(numberLocaleFor('USD')).toBe('en')
  })
})
