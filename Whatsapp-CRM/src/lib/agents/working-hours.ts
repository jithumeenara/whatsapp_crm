/**
 * When an agent is supposed to be working.
 *
 * ── Why this is separate from presence ──────────────────────────────
 *
 * src/lib/agents/presence.ts answers "is this person reachable right
 * now", measured from their own activity. This answers "is this person
 * meant to be here at all", declared in advance. They are different
 * questions and conflating them would make both useless: an agent who
 * is at their desk on a Sunday is genuinely online and genuinely off
 * shift, and a supervisor needs to see which of those is which.
 *
 * Handing work out needs both to be true. Everything else — the dot,
 * the tooltip, the member list — shows them separately.
 *
 * ── Why the timezone is stored with the hours ───────────────────────
 *
 * Nothing in this app stored a timezone before this, so "09:00" would
 * have meant nine o'clock on whichever machine happened to ask.
 *
 * On the server this was written for, that would have been the right
 * answer by luck: it is set to Asia/Kolkata, as are its Node processes
 * and its database, so shifts read from the system clock would have
 * come out correct. That is worth stating plainly, because the danger
 * here is easy to overstate and this file should not overstate it.
 *
 * It is still the wrong way to do it. A server in UTC — the default
 * almost everywhere, and what the next machine this is deployed to will
 * very likely be — would put every agent's nine-to-six between half two
 * in the afternoon and half eleven at night, silently, for the whole
 * shift every day. And one system clock cannot serve two accounts in
 * two countries however it is set. Reading the zone from the schedule
 * makes the answer correct by construction rather than by a machine
 * setting nobody in this codebase controls.
 *
 * The business has a zone of its own now (company_profiles.timezone) and
 * it is what the editor starts from, but the schedule keeps its own copy
 * rather than pointing at it: an agent can work from a different city
 * from the business that employs them, and a business that later moves
 * must not silently rewrite hours nobody asked it to.
 *
 * Hours without a zone do not parse, so there is no path that produces
 * times nobody has pinned to a clock.
 *
 * ── Why "half day" is a label and not a mechanism ───────────────────
 *
 * A half day is a working day with shorter hours. There is no second
 * rule for it, and pretending there is would mean two code paths that
 * have to agree forever. What it earns is a name: "Saturday, half day"
 * is how people actually describe the week, and a row reading 09:00 to
 * 13:00 with no label leaves the reader to work out whether that was
 * deliberate. So it changes the words and the times the editor offers,
 * and nothing else reads it.
 */

// The zone helpers live in one place, beside the list of zones
// themselves — two copies of "is this a real zone" is two answers
// waiting to disagree.
import { isKnownTimezone } from '@/lib/agents/timezones'

export { isKnownTimezone }

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]

export const DAY_NAMES: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

/** 'off' is a day away. 'full' and 'half' are both working days and are
 *  treated identically by every rule here — see the note above. */
export type DayMode = 'full' | 'half' | 'off'

export interface DayShift {
  mode: DayMode
  /** "HH:MM", 24-hour. Ignored when mode is 'off'. */
  from: string
  to: string
}

export interface WorkingHours {
  /** An IANA zone name, e.g. "Asia/Kolkata". Captured from the browser
   *  when the hours are saved, because a time without one is not a time. */
  timezone: string
  week: Record<DayKey, DayShift>
}

/**
 * What the editor opens with for somebody who has never set hours.
 *
 * A six-day week with Saturday short and Sunday off — the shape most
 * businesses here actually run, and the one the person setting this up
 * is most likely to be adjusting rather than replacing. A blank week
 * would make them fill in fourteen fields to express the ordinary case.
 */
export const DEFAULT_WEEK: Record<DayKey, DayShift> = {
  mon: { mode: 'full', from: '09:00', to: '18:00' },
  tue: { mode: 'full', from: '09:00', to: '18:00' },
  wed: { mode: 'full', from: '09:00', to: '18:00' },
  thu: { mode: 'full', from: '09:00', to: '18:00' },
  fri: { mode: 'full', from: '09:00', to: '18:00' },
  sat: { mode: 'half', from: '09:00', to: '13:00' },
  sun: { mode: 'off', from: '09:00', to: '18:00' },
}

/** The times a day gets when it is switched to half, so the editor does
 *  not make somebody type a second set of hours to express the usual
 *  meaning of the word. */
export const HALF_DAY_DEFAULT = { from: '09:00', to: '13:00' }

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "HH:MM" as minutes past midnight, or null if it is not a time. */
export function minutesOfDay(hhmm: string): number | null {
  const m = TIME_RE.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** "09:00" → "9:00 AM". The app shows clock times the way this country
 *  reads them; it stores them the way a computer sorts them. */
export function formatTime(hhmm: string): string {
  const mins = minutesOfDay(hhmm)
  if (mins === null) return hhmm
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const period = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/**
 * Read a schedule out of the database.
 *
 * The column is JSON, which means anything at all could be in it — an
 * older shape, a hand-edited row, a half-written migration. Anything
 * this cannot make sense of becomes null, which means "no hours set",
 * which means always available. That is the safe direction: a schedule
 * nobody can read must not quietly take an agent out of the rota.
 */
export function parseWorkingHours(value: unknown): WorkingHours | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>

  const timezone = typeof raw.timezone === 'string' ? raw.timezone.trim() : ''
  if (!timezone) return null

  const rawWeek = raw.week
  if (!rawWeek || typeof rawWeek !== 'object' || Array.isArray(rawWeek)) return null
  const weekIn = rawWeek as Record<string, unknown>

  const week = {} as Record<DayKey, DayShift>
  for (const day of DAY_KEYS) {
    const entry = weekIn[day]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const e = entry as Record<string, unknown>
    const mode = e.mode
    if (mode !== 'full' && mode !== 'half' && mode !== 'off') return null
    const from = typeof e.from === 'string' ? e.from : ''
    const to = typeof e.to === 'string' ? e.to : ''
    if (minutesOfDay(from) === null || minutesOfDay(to) === null) return null
    week[day] = { mode, from, to }
  }

  return { timezone, week }
}

/**
 * Check a schedule on its way in, before it is stored.
 *
 * Returns the problem in the words the person who typed it would use,
 * or null when there is nothing wrong. Deliberately strict where
 * parseWorkingHours is lenient: garbage already in the database has to
 * be survived, but garbage arriving at the API should be refused while
 * somebody is still looking at the screen and can fix it.
 */
export function validateWorkingHours(value: unknown): string | null {
  const hours = parseWorkingHours(value)
  if (!hours) return 'These working hours are not in a shape we can store.'

  if (!isKnownTimezone(hours.timezone)) {
    return `"${hours.timezone}" is not a time zone this server recognises.`
  }

  for (const day of DAY_KEYS) {
    const shift = hours.week[day]
    if (shift.mode === 'off') continue
    if (shift.from === shift.to) {
      return `${DAY_NAMES[day]} starts and ends at the same time. Set it to a day off instead.`
    }
  }
  return null
}

interface LocalClock {
  day: DayKey
  minutes: number
}

const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
}

/**
 * The day and the time it is where this agent works.
 *
 * Intl does the whole job, including the parts that are easy to get
 * wrong by hand: daylight saving, zones on a half-hour offset, and the
 * fact that "today" in Kolkata is not always today in UTC. hourCycle is
 * 'h23' rather than hour12:false because the latter is the one that
 * reports midnight as 24 on some builds.
 */
function localClock(timezone: string, now: Date): LocalClock | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)

    let day: DayKey | undefined
    let hour: number | undefined
    let minute: number | undefined
    for (const part of parts) {
      if (part.type === 'weekday') day = WEEKDAY_TO_KEY[part.value]
      else if (part.type === 'hour') hour = Number(part.value)
      else if (part.type === 'minute') minute = Number(part.value)
    }
    if (!day || hour === undefined || minute === undefined) return null
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null
    return { day, minutes: hour * 60 + minute }
  } catch {
    return null
  }
}

function previousDay(day: DayKey): DayKey {
  const i = DAY_KEYS.indexOf(day)
  return DAY_KEYS[(i + DAY_KEYS.length - 1) % DAY_KEYS.length]
}

function nextDay(day: DayKey): DayKey {
  const i = DAY_KEYS.indexOf(day)
  return DAY_KEYS[(i + 1) % DAY_KEYS.length]
}

/**
 * Is this shift running at `minutes` past midnight on its own day?
 *
 * A shift whose end is not after its start runs past midnight — 22:00
 * to 06:00 is a night shift, not an error. Hospitals run them, and
 * reading it as an empty window would have quietly emptied the night
 * rota.
 */
function coversOnOwnDay(shift: DayShift, minutes: number): boolean {
  if (shift.mode === 'off') return false
  const from = minutesOfDay(shift.from)
  const to = minutesOfDay(shift.to)
  if (from === null || to === null || from === to) return false
  if (to > from) return minutes >= from && minutes < to
  return minutes >= from // wraps past midnight; the tail is yesterday's business
}

/** The part of a shift that spilled over into the following day. */
function spillsInto(shift: DayShift, minutes: number): boolean {
  if (shift.mode === 'off') return false
  const from = minutesOfDay(shift.from)
  const to = minutesOfDay(shift.to)
  if (from === null || to === null || to >= from) return false
  return minutes < to
}

/**
 * Is this agent within their working hours right now?
 *
 * No schedule means yes. That is the behaviour every account had before
 * this existed and the one they keep until somebody deliberately sets
 * hours, so switching this on changes nothing for anybody by accident.
 *
 * A schedule with a timezone this machine cannot resolve also means yes,
 * for the same reason in a worse situation: a misconfiguration must not
 * be able to empty the rota and leave customers unanswered.
 */
export function isOnShift(hours: WorkingHours | null, now: Date = new Date()): boolean {
  if (!hours) return true
  const clock = localClock(hours.timezone, now)
  if (!clock) return true

  if (coversOnOwnDay(hours.week[clock.day], clock.minutes)) return true
  return spillsInto(hours.week[previousDay(clock.day)], clock.minutes)
}

export interface ShiftState {
  onShift: boolean
  /** One short line for a tooltip or a list row. */
  label: string
}

/**
 * What to show beside an agent's name.
 *
 * Both halves matter and neither is obvious from the other: "off shift"
 * without "back Monday 9:00 AM" leaves a supervisor to open the editor
 * to find out, and knowing when somebody is next due is most of why
 * anyone looks.
 */
export function describeShift(
  hours: WorkingHours | null,
  now: Date = new Date(),
): ShiftState {
  if (!hours) return { onShift: true, label: 'No working hours set' }

  const clock = localClock(hours.timezone, now)
  if (!clock) {
    // Said plainly rather than hidden. Somebody has to fix it, and they
    // cannot fix what the screen will not admit.
    return { onShift: true, label: `Unknown time zone (${hours.timezone})` }
  }

  const today = hours.week[clock.day]
  if (coversOnOwnDay(today, clock.minutes)) {
    const suffix = today.mode === 'half' ? ' · half day' : ''
    return { onShift: true, label: `Working until ${formatTime(today.to)}${suffix}` }
  }

  const carried = hours.week[previousDay(clock.day)]
  if (spillsInto(carried, clock.minutes)) {
    return { onShift: true, label: `Night shift until ${formatTime(carried.to)}` }
  }

  const next = nextStart(hours, clock)
  if (!next) return { onShift: false, label: 'No working days set' }
  return { onShift: false, label: `Off shift — back ${next}` }
}

/**
 * When their next shift begins, in words.
 *
 * Walks the week rather than doing date arithmetic: the answer is always
 * within seven days by definition, and a loop over seven entries cannot
 * get daylight saving wrong the way adding hours to a timestamp can.
 */
function nextStart(hours: WorkingHours, clock: LocalClock): string | null {
  const todayShift = hours.week[clock.day]
  const todayFrom = minutesOfDay(todayShift.from)
  if (todayShift.mode !== 'off' && todayFrom !== null && todayFrom > clock.minutes) {
    return `today ${formatTime(todayShift.from)}`
  }

  let day = clock.day
  for (let i = 0; i < 7; i++) {
    day = nextDay(day)
    const shift = hours.week[day]
    if (shift.mode === 'off') continue
    const when = `${DAY_NAMES[day]} ${formatTime(shift.from)}`
    return i === 0 ? `tomorrow ${formatTime(shift.from)}` : when
  }
  return null
}

/** "Mon–Fri 9:00 AM–6:00 PM · Sat half day · Sun off", for a list row
 *  that has to summarise a whole week in one line. */
export function summariseWeek(hours: WorkingHours | null): string {
  if (!hours) return 'No working hours set'

  const working = DAY_KEYS.filter((d) => hours.week[d].mode !== 'off')
  if (working.length === 0) return 'No working days'

  const parts: string[] = []
  let runStart: DayKey | null = null
  let previous: DayKey | null = null

  const sameShift = (a: DayKey, b: DayKey) =>
    hours.week[a].mode === hours.week[b].mode &&
    hours.week[a].from === hours.week[b].from &&
    hours.week[a].to === hours.week[b].to

  const flush = (endDay: DayKey) => {
    if (!runStart) return
    const shift = hours.week[runStart]
    const span =
      runStart === endDay
        ? DAY_NAMES[runStart].slice(0, 3)
        : `${DAY_NAMES[runStart].slice(0, 3)}–${DAY_NAMES[endDay].slice(0, 3)}`
    const half = shift.mode === 'half' ? ' (half)' : ''
    parts.push(`${span} ${formatTime(shift.from)}–${formatTime(shift.to)}${half}`)
    runStart = null
  }

  for (const day of DAY_KEYS) {
    if (hours.week[day].mode === 'off') {
      if (previous) flush(previous)
      previous = null
      continue
    }
    if (!runStart) runStart = day
    else if (previous && !sameShift(previous, day)) {
      flush(previous)
      runStart = day
    }
    previous = day
  }
  if (previous) flush(previous)

  const off = DAY_KEYS.filter((d) => hours.week[d].mode === 'off')
  if (off.length > 0) {
    parts.push(`${off.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ')} off`)
  }
  return parts.join(' · ')
}
