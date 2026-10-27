/**
 * A phone number typed as two boxes — country (flag + code) and the
 * number — joined the way WhatsApp wants it. Pure: shared by forms.
 */
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, splitE164 } from './country-codes'

/** "+91 98765 43210" or "0091 98765…": a whole international number. */
export function splitInternational(raw: string): { iso: string; local: string } | null {
  const t = raw.trim()
  const rest = t.startsWith('+') ? t.slice(1) : t.startsWith('00') ? t.slice(2) : null
  if (rest === null) return null
  const digits = rest.replace(/\D/g, '')
  return digits ? splitE164(`+${digits}`) : null
}

/**
 * The full number: the country's code, then the number without the
 * leading 0 people dial at home. Empty when no number is typed, so a
 * "required" check still sees nothing. A "+…" number typed into the box
 * is taken as it is.
 */
export function combinePhone(iso: string, local: string): string {
  const t = local.trim()
  if (/^(\+|00)/.test(t)) {
    const d = t.replace(/^00/, '').replace(/\D/g, '')
    return d ? `+${d}` : ''
  }
  const digits = t.replace(/\D/g, '').replace(/^0+/, '')
  if (!digits) return ''
  const dial = COUNTRY_CODES.find((c) => c.iso === iso)?.dial ?? COUNTRY_CODES.find((c) => c.iso === DEFAULT_COUNTRY_ISO)?.dial ?? '+91'
  return `${dial}${digits}`
}
