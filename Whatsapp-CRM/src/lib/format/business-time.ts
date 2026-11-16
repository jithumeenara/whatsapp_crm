/**
 * Business times shown in the business's own zone (Settings → Company),
 * not the browser's — a supervisor travelling, or a laptop set to UTC,
 * must see the same "Mon, 16 Nov, 5:55 pm" as the team (ten bug rules #10).
 * Pure; an unknown zone falls back to Asia/Kolkata like the server does.
 */

const FALLBACK = 'Asia/Kolkata'

function zoneOrFallback(zone: string | null | undefined): string {
  const z = zone?.trim()
  if (!z) return FALLBACK
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return z
  } catch {
    return FALLBACK
  }
}

/** A date and/or time in the zone. Empty for a missing or broken date. */
export function formatInZone(
  iso: string | Date | null | undefined,
  zone: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  locale = 'en-IN',
): string {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: zoneOrFallback(zone) }).format(d)
}

/** The calendar day (YYYY-MM-DD) a moment falls on in the zone. */
export function dayKeyInZone(iso: string | Date, zone: string | null | undefined): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zoneOrFallback(zone) }).format(d)
}
