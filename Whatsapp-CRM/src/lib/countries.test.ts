import { describe, expect, it } from 'vitest'
import {
  COUNTRIES,
  countryByIso,
  currencyDigits,
  isValidCountryIso,
  isValidCurrency,
  isValidReportLanguage,
  REPORT_LANGUAGES,
  searchCountries,
} from './countries'

describe('the country table', () => {
  it('covers every ISO country once, with a known time zone and currency', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(248)
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length)
    const intlCurrencies = new Set(Intl.supportedValuesOf('currency'))
    for (const c of COUNTRIES) {
      expect(c.iso).toMatch(/^[A-Z]{2}$/)
      expect(c.currency).toMatch(/^[A-Z]{3}$/)
      expect(intlCurrencies.has(c.currency), `${c.iso} ${c.currency}`).toBe(true)
      expect(() => new Intl.DateTimeFormat('en', { timeZone: c.timezone }), `${c.iso} ${c.timezone}`).not.toThrow()
    }
  })

  it('leaves out what cannot be chosen (Antarctica has no currency)', () => {
    expect(COUNTRIES.find((c) => c.iso === 'AQ')).toBeUndefined()
  })

  it('knows India', () => {
    expect(countryByIso('in')).toMatchObject({ iso: 'IN', name: 'India', dial: '+91', currency: 'INR', timezone: 'Asia/Kolkata' })
  })

  it('knows how many decimals a currency has', () => {
    expect(currencyDigits('INR')).toBe(2)
    expect(currencyDigits('JPY')).toBe(0)
    expect(currencyDigits('KWD')).toBe(3)
    expect(currencyDigits('XXX-not-real')).toBe(2)
  })
})

describe('currency list and names', () => {
  it('lists every currency the table uses, sorted, and names them', async () => {
    const { listCurrencies, currencyName } = await import('./countries')
    const all = listCurrencies()
    expect(all).toEqual([...all].sort())
    for (const code of ['INR', 'USD', 'AED', 'JPY', 'KWD']) expect(all).toContain(code)
    expect(currencyName('INR')).toMatch(/rupee/i)
    expect(currencyName('NOT-REAL')).toBe('NOT-REAL')
  })
})

describe('validation is an allow-list', () => {
  it('accepts a listed country or currency, any case, and nothing else', () => {
    expect(isValidCountryIso('IN')).toBe(true)
    expect(isValidCountryIso('in')).toBe(true)
    expect(isValidCountryIso('ZZ')).toBe(false)
    expect(isValidCountryIso('')).toBe(false)
    expect(isValidCountryIso('IN; DROP TABLE')).toBe(false)
    expect(isValidCurrency('inr')).toBe(true)
    expect(isValidCurrency('USD')).toBe(true)
    expect(isValidCurrency('ABC')).toBe(false)
    expect(isValidCurrency('<script>')).toBe(false)
  })

  it('offers English by default and only languages a report can be written in', () => {
    expect(REPORT_LANGUAGES[0].code).toBe('en')
    expect(isValidReportLanguage('en')).toBe(true)
    expect(isValidReportLanguage('ml')).toBe(true)
    expect(isValidReportLanguage('../../etc/passwd')).toBe(false)
    expect(isValidReportLanguage('xx')).toBe(false)
  })
})

describe('searchCountries', () => {
  const first = (q: string) => searchCountries(q)[0]?.iso

  it('finds by calling code, with or without the plus', () => {
    expect(first('+91')).toBe('IN')
    expect(first('91')).toBe('IN')
  })

  it('finds by name, case-insensitively, prefix first', () => {
    const iso = searchCountries('ind').map((c) => c.iso)
    expect(iso).toContain('IN')
    expect(iso).toContain('ID')
    expect(first('INDIA')).toBe('IN')
  })

  it('finds by currency code', () => {
    expect(first('inr')).toBe('IN')
    expect(searchCountries('eur').length).toBeGreaterThan(10)
  })

  it('finds by the names people actually type', () => {
    expect(first('uae')).toBe('AE')
    expect(first('usa')).toBe('US')
    expect(first('uk')).toBe('GB')
  })

  it('puts the main country of a shared calling code first', () => {
    expect(first('+1')).toBe('US')
    expect(first('+7')).toBe('RU')
  })

  it('returns everything for an empty search and nothing for nonsense', () => {
    expect(searchCountries('').length).toBe(COUNTRIES.length)
    expect(searchCountries('qqqzzz')).toEqual([])
  })
})
