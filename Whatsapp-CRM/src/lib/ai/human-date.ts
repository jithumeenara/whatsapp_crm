import { prisma } from '@/lib/db'

/**
 * Dates the assistant says to a customer, in the business's own zone.
 *
 * Formatting a Date without a time zone uses the server's clock. On a
 * machine set to UTC, a registration made at 2 a.m. in Kolkata was "on"
 * the previous day when the assistant read it back. The business's zone
 * (Settings → Company) decides; Asia/Kolkata when none is set, as
 * elsewhere in the app.
 */

const FALLBACK = 'Asia/Kolkata'
const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { zone: string; at: number }>()

function validZone(zone: string | null | undefined): string {
  const z = zone?.trim()
  if (!z) return FALLBACK
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return z
  } catch {
    return FALLBACK
  }
}

export async function businessTimezone(accountId: string): Promise<string> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.zone
  // A failed lookup must never stop a registration or an answer — the
  // date is a courtesy. It falls back like a missing setting does.
  let stored: string | null | undefined = null
  try {
    const profile = await prisma.companyProfile.findFirst({
      where: { account_id: accountId },
      select: { timezone: true },
    })
    stored = profile?.timezone
  } catch {
    stored = null
  }
  const zone = validZone(stored)
  cache.set(accountId, { zone, at: Date.now() })
  return zone
}

/** "6 October 2026" — for a person to hear, not a machine to parse. */
export function humanDate(d: Date | null | undefined, timeZone: string): string | null {
  if (!d) return null
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone })
}
