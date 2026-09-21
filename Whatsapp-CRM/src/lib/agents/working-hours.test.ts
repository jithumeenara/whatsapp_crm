import { describe, expect, it } from 'vitest'
import {
  isOnShift,
  describeShift,
  summariseWeek,
  parseWorkingHours,
  validateWorkingHours,
  formatTime,
  minutesOfDay,
  DEFAULT_WEEK,
  type WorkingHours,
  type DayShift,
} from './working-hours'

const KOLKATA = 'Asia/Kolkata'

function week(overrides: Partial<Record<keyof typeof DEFAULT_WEEK, DayShift>> = {}) {
  return { ...DEFAULT_WEEK, ...overrides }
}

function hours(overrides: Partial<WorkingHours> = {}): WorkingHours {
  return { timezone: KOLKATA, week: week(), ...overrides }
}

/** A moment, written in Kolkata's clock so the test reads the way the
 *  agent's day does. 2026-09-21 is a Monday. */
const at = (iso: string) => new Date(iso)

describe('the time zone, which nothing in this app stored before', () => {
  it("reads the shift on the agent's clock, not the server's", () => {
    // 04:00 UTC is 09:30 in Kolkata — inside a 09:00–18:00 Monday shift.
    // Evaluated in UTC it would be four in the morning and the agent
    // would be off shift for their entire working day.
    expect(isOnShift(hours(), at('2026-09-21T04:00:00Z'))).toBe(true)
  })

  it('is off shift when it is the middle of the night where they are', () => {
    // 20:00 UTC is 01:30 the next morning in Kolkata.
    expect(isOnShift(hours(), at('2026-09-21T20:00:00Z'))).toBe(false)
  })

  it('crosses the date line correctly', () => {
    // Sunday 20:00 UTC is already Monday 01:30 in Kolkata — a day off in
    // UTC terms, a working day locally, and still before the shift.
    expect(isOnShift(hours(), at('2026-09-20T20:00:00Z'))).toBe(false)
    // Sunday 23:59 UTC is Monday 05:29 — still before nine.
    expect(isOnShift(hours(), at('2026-09-20T23:59:00Z'))).toBe(false)
    // Monday 03:31 UTC is Monday 09:01. In.
    expect(isOnShift(hours(), at('2026-09-21T03:31:00Z'))).toBe(true)
  })

  it('does not empty the rota when the zone is nonsense', () => {
    // A misconfiguration must never be able to make every agent
    // unavailable and leave customers with nobody. Availability is the
    // safe direction to fail in.
    expect(isOnShift(hours({ timezone: 'Mars/Olympus' }), at('2026-09-21T20:00:00Z'))).toBe(true)
  })

  it('says so on screen rather than hiding it', () => {
    const state = describeShift(hours({ timezone: 'Mars/Olympus' }), at('2026-09-21T04:00:00Z'))
    expect(state.label).toContain('Mars/Olympus')
  })
})

describe('the edges of a shift', () => {
  it('is on shift at the exact minute it starts', () => {
    // 03:30 UTC = 09:00 Kolkata.
    expect(isOnShift(hours(), at('2026-09-21T03:30:00Z'))).toBe(true)
  })

  it('is off shift at the exact minute it ends', () => {
    // 12:30 UTC = 18:00 Kolkata. The shift is over; it does not include
    // its own end, or two consecutive shifts would both claim the same
    // minute.
    expect(isOnShift(hours(), at('2026-09-21T12:30:00Z'))).toBe(false)
    // One minute earlier is still work.
    expect(isOnShift(hours(), at('2026-09-21T12:29:00Z'))).toBe(true)
  })
})

describe('days off and half days', () => {
  it('is off shift all day on a day off', () => {
    // Sunday 2026-09-27, midday Kolkata (06:30 UTC).
    expect(isOnShift(hours(), at('2026-09-27T06:30:00Z'))).toBe(false)
  })

  it('works a half day and then stops', () => {
    // Saturday 2026-09-26. 09:00–13:00 Kolkata.
    expect(isOnShift(hours(), at('2026-09-26T05:00:00Z'))).toBe(true) // 10:30
    expect(isOnShift(hours(), at('2026-09-26T08:00:00Z'))).toBe(false) // 13:30
  })

  it('treats a half day as a working day, because that is what it is', () => {
    // There is no second rule for half days — the label is the whole
    // difference. A test that let them diverge would be inviting it.
    const asFull = hours({ week: week({ sat: { mode: 'full', from: '09:00', to: '13:00' } }) })
    const asHalf = hours({ week: week({ sat: { mode: 'half', from: '09:00', to: '13:00' } }) })
    const noon = at('2026-09-26T05:00:00Z')
    expect(isOnShift(asFull, noon)).toBe(isOnShift(asHalf, noon))
  })

  it('names the half day when it is the one being worked', () => {
    expect(describeShift(hours(), at('2026-09-26T05:00:00Z')).label).toContain('half day')
  })
})

describe('shifts that run past midnight', () => {
  const night = hours({
    week: week({
      mon: { mode: 'full', from: '22:00', to: '06:00' },
      tue: { mode: 'full', from: '22:00', to: '06:00' },
    }),
  })

  it('is on shift late on the night it starts', () => {
    // Monday 23:00 Kolkata = 17:30 UTC Monday.
    expect(isOnShift(night, at('2026-09-21T17:30:00Z'))).toBe(true)
  })

  it('is still on shift after midnight, on the next calendar day', () => {
    // Tuesday 02:00 Kolkata = 20:30 UTC Monday. This is Monday's shift
    // spilling over, and reading it as Tuesday's would have called an
    // agent in the middle of a night shift off duty.
    expect(isOnShift(night, at('2026-09-21T20:30:00Z'))).toBe(true)
  })

  it('is off shift once the night shift has ended', () => {
    // Tuesday 07:00 Kolkata = 01:30 UTC Tuesday.
    expect(isOnShift(night, at('2026-09-22T01:30:00Z'))).toBe(false)
  })

  it('does not spill over from a night the agent was not working', () => {
    // Wednesday 02:00 Kolkata — Tuesday night is a shift, so this is in.
    expect(isOnShift(night, at('2026-09-22T20:30:00Z'))).toBe(true)
    // Thursday 02:00 — Wednesday is an ordinary 09:00–18:00 day, so no.
    expect(isOnShift(night, at('2026-09-23T20:30:00Z'))).toBe(false)
  })
})

describe('no schedule at all', () => {
  it('is always available, so switching this on changes nothing by accident', () => {
    expect(isOnShift(null, at('2026-09-27T06:30:00Z'))).toBe(true)
    expect(describeShift(null).onShift).toBe(true)
  })
})

describe('when they are next due', () => {
  it('says today when the shift has not started yet', () => {
    // Monday 07:00 Kolkata = 01:30 UTC.
    expect(describeShift(hours(), at('2026-09-21T01:30:00Z')).label).toContain('today 9:00 AM')
  })

  it('says tomorrow once today is finished', () => {
    // Monday 19:00 Kolkata = 13:30 UTC.
    expect(describeShift(hours(), at('2026-09-21T13:30:00Z')).label).toContain('tomorrow')
  })

  it('says tomorrow when tomorrow really is the next working day', () => {
    // Sunday midday, and Monday is a working day. Naming the weekday
    // here would be correct but worse to read.
    expect(describeShift(hours(), at('2026-09-27T06:30:00Z')).label).toContain('tomorrow 9:00 AM')
  })

  it('skips over the days off to find the real next one', () => {
    // Friday evening on a five-day week: the answer is Monday, and an
    // implementation that only looked at tomorrow would have said
    // Saturday, a day this agent does not work.
    const fiveDay = hours({
      week: week({
        sat: { mode: 'off', from: '09:00', to: '18:00' },
        sun: { mode: 'off', from: '09:00', to: '18:00' },
      }),
    })
    // Friday 2026-09-25, 19:00 Kolkata = 13:30 UTC.
    expect(describeShift(fiveDay, at('2026-09-25T13:30:00Z')).label).toContain('Monday 9:00 AM')
  })

  it('admits it when there are no working days at all', () => {
    const none = hours({
      week: Object.fromEntries(
        Object.keys(DEFAULT_WEEK).map((d) => [d, { mode: 'off', from: '09:00', to: '18:00' }]),
      ) as WorkingHours['week'],
    })
    expect(describeShift(none, at('2026-09-21T04:00:00Z')).label).toBe('No working days set')
  })
})

describe('reading a row out of the database', () => {
  it('accepts a schedule it wrote itself', () => {
    expect(parseWorkingHours(hours())).not.toBeNull()
  })

  it('treats anything it cannot understand as no schedule', () => {
    // Which means always available. A row nobody can read must not
    // quietly take an agent out of the rota.
    expect(parseWorkingHours(null)).toBeNull()
    expect(parseWorkingHours('09:00-18:00')).toBeNull()
    expect(parseWorkingHours({ week: DEFAULT_WEEK })).toBeNull() // no zone
    expect(parseWorkingHours({ timezone: KOLKATA })).toBeNull() // no week
    expect(parseWorkingHours({ timezone: KOLKATA, week: { mon: DEFAULT_WEEK.mon } })).toBeNull()
  })

  it('rejects a day whose mode is invented', () => {
    expect(
      parseWorkingHours({
        timezone: KOLKATA,
        week: { ...DEFAULT_WEEK, mon: { mode: 'maybe', from: '09:00', to: '18:00' } },
      }),
    ).toBeNull()
  })

  it('rejects times that are not times', () => {
    expect(
      parseWorkingHours({
        timezone: KOLKATA,
        week: { ...DEFAULT_WEEK, mon: { mode: 'full', from: '9am', to: '18:00' } },
      }),
    ).toBeNull()
    expect(
      parseWorkingHours({
        timezone: KOLKATA,
        week: { ...DEFAULT_WEEK, mon: { mode: 'full', from: '25:00', to: '18:00' } },
      }),
    ).toBeNull()
  })
})

describe('refusing bad input at the door', () => {
  it('passes a schedule that makes sense', () => {
    expect(validateWorkingHours(hours())).toBeNull()
  })

  it('names the day when its hours are empty', () => {
    const bad = hours({ week: week({ wed: { mode: 'full', from: '09:00', to: '09:00' } }) })
    expect(validateWorkingHours(bad)).toContain('Wednesday')
  })

  it('refuses a time zone this server does not know', () => {
    // Stricter than isOnShift on purpose: garbage already in the
    // database has to be survived, but garbage arriving at the API can
    // still be fixed by the person looking at the screen.
    expect(validateWorkingHours(hours({ timezone: 'Mars/Olympus' }))).toContain('Mars/Olympus')
  })
})

describe('the small pieces', () => {
  it('reads clock times the way this country does', () => {
    expect(formatTime('09:00')).toBe('9:00 AM')
    expect(formatTime('13:30')).toBe('1:30 PM')
    expect(formatTime('00:15')).toBe('12:15 AM')
    expect(formatTime('12:00')).toBe('12:00 PM')
    expect(formatTime('23:59')).toBe('11:59 PM')
  })

  it('parses a stored time', () => {
    expect(minutesOfDay('00:00')).toBe(0)
    expect(minutesOfDay('09:30')).toBe(570)
    expect(minutesOfDay('24:00')).toBeNull()
    expect(minutesOfDay('9:30')).toBeNull()
  })
})

describe('the week in one line', () => {
  it('collapses identical days into a range', () => {
    expect(summariseWeek(hours())).toBe(
      'Mon–Fri 9:00 AM–6:00 PM · Sat 9:00 AM–1:00 PM (half) · Sun off',
    )
  })

  it('does not pretend different days are the same', () => {
    const mixed = hours({ week: week({ wed: { mode: 'full', from: '12:00', to: '20:00' } }) })
    expect(summariseWeek(mixed)).toContain('Wed 12:00 PM–8:00 PM')
  })

  it('says plainly when there is nothing set', () => {
    expect(summariseWeek(null)).toBe('No working hours set')
  })
})
