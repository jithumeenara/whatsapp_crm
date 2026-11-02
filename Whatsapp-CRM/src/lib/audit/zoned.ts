/**
 * Business-zone dates for the audit log, usable in the browser and on the
 * server. A day picked in the filter bar ("2 Nov") means 2 Nov in the
 * business's zone, not the browser's or the server's, and travels as ISO
 * with that zone's offset (AGENTS.md rule 10). Pure: no I/O, no server clock
 * reads beyond what the caller passes.
 */

/** Minutes the zone is ahead of UTC at that instant (Kolkata: 330). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

function pad(n: number): string {
  return String(Math.abs(n)).padStart(2, '0')
}

function offsetText(min: number): string {
  const sign = min < 0 ? '-' : '+'
  return `${sign}${pad(Math.trunc(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** "2026-11-02" → "2026-11-02T00:00:00+05:30": midnight of that day in the zone. */
export function dayStartIso(day: string, timeZone: string): string | null {
  const m = DAY.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const guess = Date.UTC(y, mo - 1, d)
  if (Number.isNaN(guess) || new Date(guess).getUTCDate() !== d) return null
  // Two passes settle a day on which the offset changes (DST zones).
  let off = zoneOffsetMinutes(new Date(guess), timeZone)
  off = zoneOffsetMinutes(new Date(guess - off * 60000), timeZone)
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00${offsetText(off)}`
}

/** Midnight at the end of that day in the zone (start of the next day). */
export function dayEndIso(day: string, timeZone: string): string | null {
  const m = DAY.exec(day)
  if (!m) return null
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
  return dayStartIso(next.toISOString().slice(0, 10), timeZone)
}

/** The calendar day an instant falls on in the zone, as "YYYY-MM-DD". */
export function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** "2 Nov 2026, 14:05" in the zone. */
export function zonedDateTime(at: Date, timeZone: string): string {
  return at.toLocaleString('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
