/**
 * Countries, calling codes and currencies, for the business profile's
 * "Country & currency" picker and for validating what it sends.
 *
 * The table is generated (countries-data.ts); this module is the lookups.
 * Validation is an allow-list: a country or currency is accepted only if it
 * is in the table, never because it looks right.
 *
 * Plain data and functions, safe in the browser and on the server.
 */
import { COUNTRY_ROWS } from './countries-data'

export interface Country {
  /** ISO 3166-1 alpha-2, upper case. */
  iso: string
  /** English name. Use Intl.DisplayNames to show it in another language. */
  name: string
  /** "+91". Several countries share "+1" and "+7": see mainForDial. */
  dial: string
  /** The country's own currency (ISO 4217). */
  currency: string
  /** Decimal places that currency uses (JPY 0, INR 2, KWD 3). */
  currencyDigits: number
  /** The country's main IANA time zone. */
  timezone: string
  /** True for the country that owns a shared calling code (the US for +1). */
  mainForDial: boolean
}

/** Antarctica has no currency and cannot be chosen. */
export const COUNTRIES: readonly Country[] = COUNTRY_ROWS.filter((r) => r[7]).map((r) => ({
  iso: r[0],
  name: r[1],
  dial: r[2],
  currency: r[3],
  currencyDigits: r[4],
  timezone: r[5],
  mainForDial: r[6],
}))

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]))

export function countryByIso(iso: string | null | undefined): Country | null {
  return BY_ISO.get(String(iso ?? '').trim().toUpperCase()) ?? null
}

export function isValidCountryIso(iso: unknown): iso is string {
  return typeof iso === 'string' && BY_ISO.has(iso.trim().toUpperCase())
}

const DIGITS = new Map<string, number>()
for (const c of COUNTRIES) if (!DIGITS.has(c.currency)) DIGITS.set(c.currency, c.currencyDigits)

let intlCurrencies: Set<string> | null = null
function allCurrencies(): Set<string> {
  if (!intlCurrencies) {
    const fromIntl = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency') ?? []
    intlCurrencies = new Set([...DIGITS.keys(), ...fromIntl])
  }
  return intlCurrencies
}

/** A currency code Intl and the table both know. */
export function isValidCurrency(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z]{3}$/.test(code.trim()) && allCurrencies().has(code.trim().toUpperCase())
}

/** Every currency code the picker offers, sorted. */
export function listCurrencies(): string[] {
  return [...allCurrencies()].sort()
}

/** "INR" → "Indian Rupee" (in another language with `locale`); the code when unknown. */
export function currencyName(code: string, locale = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/** Decimal places a currency uses; 2 when it is not known. */
export function currencyDigits(code: string): number {
  const key = String(code ?? '').trim().toUpperCase()
  const known = DIGITS.get(key)
  if (known !== undefined) return known
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: key }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** The CSS classes of a country's SVG flag (flag-icons). Emoji flags show as
 *  two letters on Windows, so they are never used. */
export function flagClass(iso: string): string {
  return `fi fi-${iso.toLowerCase()}`
}

/** Languages a report can be written in. English is the default. Each one
 *  needs a dictionary in src/lib/reports/i18n; a code is offered here only
 *  once it has one. `native` is the name in its own script. */
export const REPORT_LANGUAGES: ReadonlyArray<{ code: string; name: string; native: string; rtl: boolean }> = [
  { code: 'en', name: 'English', native: 'English', rtl: false },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', rtl: false },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', rtl: false },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', rtl: false },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', rtl: false },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', rtl: false },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', rtl: false },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
]

export function isValidReportLanguage(code: unknown): code is string {
  return typeof code === 'string' && REPORT_LANGUAGES.some((l) => l.code === code)
}

// What people type that is not the official name.
const ALIASES: Record<string, string> = {
  uae: 'AE', emirates: 'AE', usa: 'US', america: 'US', 'united states of america': 'US',
  uk: 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB',
  burma: 'MM', 'ivory coast': 'CI', 'czech republic': 'CZ', 'south korea': 'KR', korea: 'KR',
  russia: 'RU', holland: 'NL', turkey: 'TR', vietnam: 'VN', laos: 'LA', swaziland: 'SZ', macedonia: 'MK',
}

/** Countries matching what was typed: a name, a calling code (+91 or 91), a
 *  currency code, or a common alias. Best matches first; the main country of
 *  a shared calling code before the others. Empty search: everyone, by name. */
export function searchCountries(query: string): Country[] {
  const q = String(query ?? '').trim().toLowerCase()
  const byName = (a: Country, b: Country) => a.name.localeCompare(b.name)
  if (!q) return [...COUNTRIES].sort(byName)

  const dialQuery = /^\+?\d+$/.test(q) ? `+${q.replace('+', '')}` : null
  const ranked: Array<{ c: Country; rank: number }> = []
  for (const c of COUNTRIES) {
    const name = c.name.toLowerCase()
    let rank = -1
    if (ALIASES[q] === c.iso || c.iso.toLowerCase() === q || c.currency.toLowerCase() === q) rank = 0
    else if (dialQuery && c.dial.startsWith(dialQuery)) rank = c.dial === dialQuery ? 0 : 1
    else if (name.startsWith(q)) rank = 1
    else if (name.split(/[\s-]+/).some((w) => w.startsWith(q)) || c.currency.toLowerCase().startsWith(q)) rank = 2
    else if (Object.entries(ALIASES).some(([k, iso]) => iso === c.iso && k.startsWith(q))) rank = 2
    if (rank >= 0) ranked.push({ c, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank || Number(b.c.mainForDial) - Number(a.c.mainForDial) || byName(a.c, b.c))
  return ranked.map((r) => r.c)
}
