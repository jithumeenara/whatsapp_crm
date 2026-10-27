import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO } from './country-codes'

/** The account's starting country — its admin's — fetched once per page
 *  load, not on every open. A failed fetch is forgotten, so the next
 *  open tries again; meanwhile India. */
let defaultCountry: Promise<string> | null = null
export function loadDefaultCountry(): Promise<string> {
  if (!defaultCountry) {
    defaultCountry = fetch('/api/conversations/new-chat', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const iso = typeof d?.default_country_iso === 'string' ? d.default_country_iso : ''
        return COUNTRY_CODES.some((c) => c.iso === iso) ? iso : DEFAULT_COUNTRY_ISO
      })
      .catch(() => {
        defaultCountry = null
        return DEFAULT_COUNTRY_ISO
      })
  }
  return defaultCountry
}
