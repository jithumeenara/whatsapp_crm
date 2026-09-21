/**
 * Every time zone in the world, and how to say one out loud.
 *
 * ── Why the list is asked for rather than written down ──────────────
 *
 * There are around four hundred IANA zones and the set changes: zones
 * are added, renamed and merged as countries change their rules, and
 * several have changed in the last few years alone. A list typed into
 * this file would have been wrong within a year and wrong silently —
 * somebody in a newly-split zone would simply not find their own city.
 *
 * `Intl.supportedValuesOf('timeZone')` asks the runtime for the list it
 * is actually going to use, which is the only list that can be right:
 * a zone this machine has never heard of would fail every calculation
 * anyway, so offering it would be offering a broken choice.
 *
 * ── Why offsets are computed and never stored ───────────────────────
 *
 * "+5:30" is a property of a moment, not of a zone. Half the world
 * changes offset twice a year, and a stored offset is a value that is
 * correct for six months and wrong for the other six. So the zone name
 * is what gets saved, everywhere, and the offset is worked out fresh
 * whenever it is shown.
 */

/**
 * Zones the world renamed, and the runtime did not.
 *
 * `Intl.supportedValuesOf` hands back whatever names this machine's ICU
 * data uses, and on a great many of them that is still the old set:
 * Asia/Calcutta rather than Asia/Kolkata, Europe/Kiev rather than
 * Europe/Kyiv. Checked on the Node this project runs — Asia/Kolkata is
 * not in its list at all.
 *
 * Left alone, an Indian user searching their own city would have found
 * nothing, and the picker would have offered them "Calcutta", a name the
 * city has not used since 2001. That is a small humiliation to ship and
 * an easy one to avoid.
 *
 * Both spellings resolve correctly as input everywhere — verified, not
 * assumed — so this changes only what is read and what is searched, and
 * never what is computed. The id that gets stored is still the one the
 * runtime itself listed, which is the one guaranteed to work on the
 * machine that listed it.
 *
 * Renames only. Zones that were merged into another (Europe/Uzhgorod
 * into Kyiv, say) are deliberately absent: those are not two names for
 * one place, and offering them as if they were would be a different
 * lie.
 */
const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Asia/Thimbu': 'Asia/Thimphu',
}

/** The other direction, so a stored modern name still finds its row. */
const RENAMED_BACK: Record<string, string> = Object.fromEntries(
  Object.entries(RENAMED).map(([legacy, modern]) => [modern, legacy]),
)

/** The name to put in front of a person. The current one, wherever the
 *  runtime is still using the old one. */
export function displayZoneId(timezone: string): string {
  return RENAMED[timezone] ?? timezone
}

/** Every spelling of a zone worth matching a search against. */
function spellingsOf(timezone: string): string[] {
  const other = RENAMED[timezone] ?? RENAMED_BACK[timezone]
  return other ? [timezone, other] : [timezone]
}

/** A small, deliberately boring fallback for a browser too old to answer
 *  the question — one zone per major offset, so the picker is never
 *  empty even where it cannot be complete. The app says so on screen
 *  rather than pretending this is the whole world. */
const FALLBACK_ZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
]

let cached: string[] | null = null

/**
 * Every zone this machine knows, sorted.
 *
 * Cached because the answer cannot change while the page is open and
 * building it is the expensive part of opening the picker.
 */
export function allTimezones(): string[] {
  if (cached) return cached
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone')
    cached = supported && supported.length > 0 ? [...supported].sort() : [...FALLBACK_ZONES]
  } catch {
    cached = [...FALLBACK_ZONES]
  }
  return cached
}

/** True when the full list was available — the picker says so when it
 *  was not, because "I cannot find my city" deserves an explanation. */
export function hasFullTimezoneList(): boolean {
  return allTimezones().length > FALLBACK_ZONES.length
}

/** What this browser believes it is set to. The starting point for
 *  somebody who has never chosen, because it is almost always right. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * "UTC+5:30" for a zone, right now.
 *
 * `shortOffset` gives "GMT+5:30"; the GMT is swapped for UTC because
 * that is what the rest of this app and most of the world writes. An
 * offset that cannot be worked out returns an empty string rather than
 * a guess — a wrong offset beside a zone name is worse than none, since
 * it is the part people check.
 */
export function offsetLabel(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(now)
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    if (!raw) return ''
    if (raw === 'GMT') return 'UTC+0:00'
    return raw.replace('GMT', 'UTC')
  } catch {
    return ''
  }
}

/** "10:31 AM" in that zone, for the line under the picker. Showing the
 *  actual clock is what turns a list of unfamiliar names into a choice
 *  somebody can verify at a glance. */
export function currentTimeIn(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now)
  } catch {
    return ''
  }
}

/** "Asia/Kolkata" → "Kolkata · Asia". The city is what people search
 *  for and read; the region is what disambiguates the handful of cities
 *  that share a name. Shown under the name the city uses today, even
 *  where this machine still files it under the old one. */
export function describeZone(timezone: string): { city: string; region: string } {
  const parts = displayZoneId(timezone).split('/')
  if (parts.length === 1) return { city: timezone, region: '' }
  const city = parts[parts.length - 1].replace(/_/g, ' ')
  return { city, region: parts.slice(0, -1).join(' / ').replace(/_/g, ' ') }
}

/**
 * Zones matching what somebody has typed.
 *
 * Matches the whole name, so "asia/kol", "kolkata" and "india" all find
 * something useful — the last of those because IANA names a few zones
 * after countries rather than cities, and somebody searching for their
 * country should not come up empty.
 */
export function searchTimezones(query: string, limit = 80): string[] {
  const zones = allTimezones()
  const q = query.trim().toLowerCase().replace(/\s+/g, '_')
  if (!q) return zones.slice(0, limit)

  // Cities first. Somebody typing "york" means New York, and a list
  // that opened with "America/New_York" buried under region matches
  // would read as if the search were broken.
  const byCity: string[] = []
  const byAnything: string[] = []
  for (const zone of zones) {
    // Both spellings, so "Kolkata" finds the zone this machine calls
    // Calcutta and "Kyiv" finds the one it calls Kiev.
    const spellings = spellingsOf(zone).map((z) => z.toLowerCase())
    if (!spellings.some((z) => z.includes(q))) continue
    if (spellings.some((z) => (z.split('/').pop() ?? '').includes(q))) byCity.push(zone)
    else byAnything.push(zone)
  }
  return [...byCity, ...byAnything].slice(0, limit)
}
