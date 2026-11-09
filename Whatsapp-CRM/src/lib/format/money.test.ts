import { describe, expect, it } from 'vitest'
import { formatAmount, formatCost, numberLocaleFor } from './money'

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

describe('formatAmount edge cases', () => {
  it('never prints a negative zero', () => {
    expect(plain(formatAmount(-0, 'USD'))).toBe('$0.00')
    expect(plain(formatAmount(-0.001, 'USD'))).toBe('$0.00')
  })

  it('prints a plain number when there is no currency, without a stray space', () => {
    expect(formatAmount(5, '')).toBe('5.00')
  })
})

describe('formatCost: small costs that must not read as zero', () => {
  it('shows an amount under one cent as less than one cent, never as zero', () => {
    expect(plain(formatCost(0.000001, 'USD'))).toBe('<$0.01')
    expect(plain(formatCost(0.004, 'USD'))).toBe('<$0.01')
  })

  it('shows an ordinary amount, and a real zero, as they are', () => {
    expect(plain(formatCost(0.5, 'USD'))).toBe('$0.50')
    expect(plain(formatCost(1234.5, 'USD'))).toBe('$1,234.50')
    expect(plain(formatCost(0, 'USD'))).toBe('$0.00')
  })
})

describe('numberLocaleFor', () => {
  it('uses lakh grouping for rupees and a neutral locale otherwise', () => {
    expect(numberLocaleFor('INR')).toBe('en-IN')
    expect(numberLocaleFor('USD')).toBe('en')
  })
})
