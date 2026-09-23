/**
 * Turning a time somebody said into a moment the server can store.
 *
 * ── Why this is its own file ────────────────────────────────────────
 *
 * "Tomorrow at nine" is a wall clock, and a wall clock is not a moment
 * until you know whose wall it is on. The same words mean four
 * different instants to a business in Kerala, one in Dubai and a server
 * in Frankfurt, and getting it wrong means ringing somebody at six in
 * the morning.
 *
 * This lived inside callback-slots.ts, where it was written to offer a
 * customer three times to choose from. The assistant now needs the same
 * arithmetic for the opposite direction — a customer who named their
 * own time — and two copies of daylight-saving handling is one copy too
 * many.
 *
 * Everything here goes through Intl with an explicit `timeZone`, which
 * knows about half-hour offsets, daylight saving, and the fact that
 * "today" in Kolkata is not always today in UTC. Doing it by hand is
 * easy to get wrong and impossible to notice when you have.
 */

/** A zone's offset from UTC, in milliseconds, at a given instant. */
export function offsetAt(timezone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    const asIfUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    )
    if (Number.isNaN(asIfUtc)) return null
    return asIfUtc - at.getTime()
  } catch {
    return null
  }
}

/** Today's date where the business is, as `YYYY-MM-DD`. */
export function localDate(timezone: string, now: Date = new Date()): string | null {
  try {
    // en-CA formats as YYYY-MM-DD, which is the one locale that gives
    // the ISO order without assembling it by hand.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return null
  }
}

/** The day of the week where the business is — "Tuesday". */
export function localWeekday(timezone: string, now: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now)
  } catch {
    return null
  }
}

/**
 * A wall-clock date and time in `timezone`, as a real moment.
 *
 * @param date `YYYY-MM-DD` as the business's calendar reads it.
 * @param time `HH:MM`, 24-hour.
 *
 * ── Why the offset is measured twice ────────────────────────────────
 *
 * The offset is read at the naive instant and subtracted; but on a
 * transition day the corrected instant can land on the far side of the
 * change, where the offset is different. Measuring again there and
 * re-correcting settles it. Both passes ask the zone rather than assume
 * an offset, which is wrong twice a year in half the world.
 *
 * ── Why a time that does not exist returns null ─────────────────────
 *
 * On the morning a zone springs forward the clock goes straight from
 * 01:59 to 03:00, so "02:30" is not a time that happens. The correction
 * above cannot produce it and lands an hour away instead. Returning
 * that would mean agreeing to 2:30 and ringing at 3:30, which is worse
 * than admitting the time was not understood — so the answer is read
 * back, and a mismatch is refused.
 */
export function zonedInstant(timezone: string, date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!d || !t) return null

  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [hh, mm] = [Number(t[1]), Number(t[2])]
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
  if (hh > 23 || mm > 59) return null

  const naive = Date.UTC(y, mo - 1, day, hh, mm, 0)

  // Date.UTC normalises an out-of-range day — 31 February becomes 3
  // March — which would silently accept a date nobody meant. Reading it
  // back catches that.
  if (
    new Date(naive).getUTCFullYear() !== y ||
    new Date(naive).getUTCMonth() !== mo - 1 ||
    new Date(naive).getUTCDate() !== day
  ) {
    return null
  }

  const first = offsetAt(timezone, new Date(naive))
  if (first === null) return null
  let result = naive - first

  const second = offsetAt(timezone, new Date(result))
  if (second !== null && second !== first) result = naive - second

  const at = new Date(result)
  const landed = offsetAt(timezone, at)
  if (landed === null) return null
  if (at.getTime() + landed !== naive) return null

  return at
}
