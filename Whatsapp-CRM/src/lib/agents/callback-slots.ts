/**
 * Asking the customer when to ring them back, in times somebody can
 * actually answer.
 *
 * ── Why the customer picks and not us ───────────────────────────────
 *
 * When nobody takes a conversation, the alternative to asking is
 * promising: "we'll get back to you shortly", and then somebody rings
 * at a time the customer is at work. Bain's NPS Prism team measured
 * letting people choose their own callback slot at up to 28 points of
 * satisfaction, and the mechanism is not mysterious — a time they chose
 * is a time they answer, which is also the only measure the business
 * cares about.
 *
 * ── Why buttons and not a question ──────────────────────────────────
 *
 * "When would suit you?" comes back as "evening", "after 6", "anytime",
 * "ഇന്ന് വൈകിട്ട്". Turning that into a timestamp is a guess, and a
 * guess here means ringing at the wrong time — which is worse than not
 * asking. Three taps, three exact times, nothing to parse.
 *
 * ── Why the slots come from the rota ────────────────────────────────
 *
 * Offering "this evening" at nine at night, when the office closed at
 * six, is the same broken promise in a politer font. Every slot here is
 * inside somebody's working hours, in the business's own time zone, and
 * a Sunday is never offered to a business that is shut on Sundays.
 *
 * This is where the working-hours and time-zone work earns its keep:
 * without them there is no honest way to name a time at all.
 */

import { DAY_KEYS, DAY_NAMES, minutesOfDay, type WorkingHours } from './working-hours'

/** Three, because that is what WhatsApp allows as reply buttons and
 *  because a fourth would not change anybody's answer. */
export const MAX_SLOTS = 3

/** Far enough ahead that somebody has time to pick the conversation up
 *  first, close enough that it still feels like today. */
const SOONEST_MINUTES = 45

/** How far forward to look for an open day before giving up. A week
 *  covers every rota; past that the business is shut. */
const SEARCH_DAYS = 8

export interface CallbackSlot {
  /** Stable, and what comes back on the button reply. */
  id: string
  /** What the customer reads: "Today 4:00 PM", "Monday 10:00 AM". */
  label: string
  /** The actual moment, in UTC, for the follow-up row. */
  at: Date
}

interface LocalNow {
  dayIndex: number
  minutes: number
}

/**
 * Where the business's clock is right now.
 *
 * Intl does daylight saving, half-hour offsets and the fact that
 * "today" in Kolkata is not always today in UTC — all of which are easy
 * to get wrong by hand and impossible to notice when you have.
 */
function localNow(timezone: string, now: Date): LocalNow | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)

    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
    const hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value)

    const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
    const dayIndex = map[weekday]
    if (dayIndex === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return null
    return { dayIndex, minutes: hour * 60 + minute }
  } catch {
    return null
  }
}

/**
 * The UTC instant of a local wall-clock time, a given number of days
 * ahead.
 *
 * Done by measuring the zone's offset at roughly the right moment and
 * correcting, rather than by assuming one — an assumed offset is wrong
 * twice a year in half the world, and wrong in exactly the week when
 * somebody is most likely to notice a callback arriving an hour out.
 */
function instantFor(timezone: string, now: Date, daysAhead: number, minutesOfDayLocal: number): Date | null {
  try {
    const probe = new Date(now.getTime() + daysAhead * 24 * 60 * 60_000)

    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const [y, m, d] = fmt.format(probe).split('-').map(Number)
    if (!y || !m || !d) return null

    const hh = Math.floor(minutesOfDayLocal / 60)
    const mm = minutesOfDayLocal % 60

    // Treat the wall-clock time as if it were UTC, then subtract the
    // zone's actual offset at that moment.
    const asUtc = Date.UTC(y, m - 1, d, hh, mm, 0)
    const offsetMs = offsetAt(timezone, new Date(asUtc))
    if (offsetMs === null) return null
    return new Date(asUtc - offsetMs)
  } catch {
    return null
  }
}

/** A zone's offset from UTC, in milliseconds, at a given instant. */
function offsetAt(timezone: string, at: Date): number | null {
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

function clockLabel(minutesOfDayLocal: number): string {
  const h24 = Math.floor(minutesOfDayLocal / 60)
  const m = minutesOfDayLocal % 60
  const period = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/**
 * Up to three times this business could actually ring back.
 *
 * Returns an empty list when there is no rota to read, and the caller
 * then says something honest and vague rather than naming a time it
 * cannot keep. Naming one it cannot keep is the failure this whole
 * module exists to avoid.
 */
export function callbackSlots(hours: WorkingHours | null, now: Date = new Date()): CallbackSlot[] {
  if (!hours) return []
  const local = localNow(hours.timezone, now)
  if (!local) return []

  const slots: CallbackSlot[] = []

  for (let ahead = 0; ahead < SEARCH_DAYS && slots.length < MAX_SLOTS; ahead++) {
    const dayKey = DAY_KEYS[(local.dayIndex + ahead) % 7]
    const shift = hours.week[dayKey]
    if (!shift || shift.mode === 'off') continue

    const from = minutesOfDay(shift.from)
    const to = minutesOfDay(shift.to)
    if (from === null || to === null) continue

    // A night shift's window wraps past midnight. Callbacks are only
    // offered inside the part that falls on this day, because "Monday
    // 2:00 AM" is a time nobody reads as Monday.
    const close = to > from ? to : 24 * 60

    // Two candidates per day: soon after opening, and mid-shift. Two
    // rather than every hour, because a customer choosing between eight
    // times is doing work the business should have done.
    const candidates = [from + 60, Math.floor((from + close) / 2)]

    for (const minutes of candidates) {
      if (slots.length >= MAX_SLOTS) break
      if (minutes >= close) continue

      // Today only counts from far enough ahead that somebody might
      // still pick the conversation up first.
      if (ahead === 0 && minutes < local.minutes + SOONEST_MINUTES) continue

      const at = instantFor(hours.timezone, now, ahead, minutes)
      if (!at || at.getTime() <= now.getTime()) continue
      if (slots.some((s) => s.at.getTime() === at.getTime())) continue

      const when =
        ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : DAY_NAMES[dayKey]
      slots.push({
        id: `cb_${ahead}_${minutes}`,
        // WhatsApp caps a reply button's title at 20 characters, so
        // this has to stay short enough to survive being sent.
        label: `${when} ${clockLabel(minutes)}`.slice(0, 20),
        at,
      })
    }
  }

  return slots
}
