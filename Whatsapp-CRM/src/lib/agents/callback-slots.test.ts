import { describe, expect, it } from 'vitest'
import { callbackSlots, MAX_SLOTS } from './callback-slots'
import { DEFAULT_WEEK, type WorkingHours, type DayShift } from './working-hours'

const KOLKATA = 'Asia/Kolkata'

function hours(over: Partial<Record<keyof typeof DEFAULT_WEEK, DayShift>> = {}): WorkingHours {
  return { timezone: KOLKATA, week: { ...DEFAULT_WEEK, ...over } }
}

/** 2026-09-21 is a Monday. Kolkata is UTC+5:30. */
const at = (iso: string) => new Date(iso)

/** What the business's clock says, for asserting against labels. */
const localOf = (d: Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: KOLKATA,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)

describe('the times it offers', () => {
  it('offers at most three, because that is what a reply fits', () => {
    expect(callbackSlots(hours(), at('2026-09-21T01:00:00Z')).length).toBeLessThanOrEqual(MAX_SLOTS)
  })

  it('never offers a time in the past', () => {
    const now = at('2026-09-21T09:00:00Z') // 2:30 PM Monday
    for (const s of callbackSlots(hours(), now)) {
      expect(s.at.getTime()).toBeGreaterThan(now.getTime())
    }
  })

  it('leaves room for somebody to pick the chat up first', () => {
    // A callback forty minutes out is worse than useless: an agent may
    // well answer in the meantime, and the customer has been told to
    // expect a call that then does not come.
    const now = at('2026-09-21T09:00:00Z')
    for (const s of callbackSlots(hours(), now)) {
      expect(s.at.getTime() - now.getTime()).toBeGreaterThanOrEqual(40 * 60_000)
    }
  })

  it('gives each one a distinct moment', () => {
    const slots = callbackSlots(hours(), at('2026-09-21T01:00:00Z'))
    const times = slots.map((s) => s.at.getTime())
    expect(new Set(times).size).toBe(times.length)
  })

  it('keeps labels short enough for WhatsApp to accept', () => {
    // Meta caps a reply button title at 20 characters and rejects the
    // whole message if one is longer — so a label that overflows does
    // not truncate, it means the customer is asked nothing at all.
    for (const s of callbackSlots(hours(), at('2026-09-21T01:00:00Z'))) {
      expect(s.label.length).toBeLessThanOrEqual(20)
    }
  })
})

describe('it only names times somebody is there', () => {
  it('offers nothing on a day the business is shut', () => {
    // Sunday midday. Every slot must land on Monday or later.
    const slots = callbackSlots(hours(), at('2026-09-27T06:30:00Z'))
    expect(slots.length).toBeGreaterThan(0)
    for (const s of slots) {
      expect(localOf(s.at).startsWith('Sun')).toBe(false)
    }
  })

  it('skips to the next open day when the business is shut all week but one', () => {
    const mondayOnly = hours({
      tue: { mode: 'off', from: '09:00', to: '18:00' },
      wed: { mode: 'off', from: '09:00', to: '18:00' },
      thu: { mode: 'off', from: '09:00', to: '18:00' },
      fri: { mode: 'off', from: '09:00', to: '18:00' },
      sat: { mode: 'off', from: '09:00', to: '18:00' },
      sun: { mode: 'off', from: '09:00', to: '18:00' },
    })
    // Tuesday morning — the next opening is the following Monday.
    const slots = callbackSlots(mondayOnly, at('2026-09-22T04:00:00Z'))
    expect(slots.length).toBeGreaterThan(0)
    for (const s of slots) expect(localOf(s.at).startsWith('Mon')).toBe(true)
  })

  it('rolls past today once the shift has ended', () => {
    // Monday 8:30 PM Kolkata, office closed at six.
    const slots = callbackSlots(hours(), at('2026-09-21T15:00:00Z'))
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].label.startsWith('Today')).toBe(false)
  })

  it('offers today when there is still shift left', () => {
    // Monday 10:00 AM Kolkata.
    const slots = callbackSlots(hours(), at('2026-09-21T04:30:00Z'))
    expect(slots.some((s) => s.label.startsWith('Today'))).toBe(true)
  })

  it('uses the business time zone, not the server clock', () => {
    // The whole reason the zone is stored. Every offered moment has to
    // land inside 09:00–18:00 as Kolkata reads it, not as UTC does.
    for (const s of callbackSlots(hours(), at('2026-09-21T01:00:00Z'))) {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: KOLKATA,
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(s.at),
      )
      expect(hour).toBeGreaterThanOrEqual(9)
      expect(hour).toBeLessThan(18)
    }
  })

  it('respects a half day rather than treating it as a full one', () => {
    // Saturday, 09:00–13:00. Nothing may be offered after one o'clock.
    const saturday = callbackSlots(hours(), at('2026-09-26T02:00:00Z'))
    const sameDay = saturday.filter((s) => s.label.startsWith('Today'))
    for (const s of sameDay) {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: KOLKATA,
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(s.at),
      )
      expect(hour).toBeLessThan(13)
    }
  })
})

describe('when it will not name a time at all', () => {
  it('offers nothing when there is no rota to read', () => {
    // The caller then says something honest and vague. Naming a time
    // the business cannot keep is the failure this exists to avoid.
    expect(callbackSlots(null, at('2026-09-21T04:00:00Z'))).toEqual([])
  })

  it('offers nothing for a zone this machine cannot resolve', () => {
    const broken: WorkingHours = { timezone: 'Mars/Olympus', week: DEFAULT_WEEK }
    expect(callbackSlots(broken, at('2026-09-21T04:00:00Z'))).toEqual([])
  })

  it('offers nothing when the business is never open', () => {
    const never = hours(
      Object.fromEntries(
        Object.keys(DEFAULT_WEEK).map((d) => [d, { mode: 'off', from: '09:00', to: '18:00' }]),
      ) as Partial<Record<keyof typeof DEFAULT_WEEK, DayShift>>,
    )
    expect(callbackSlots(never, at('2026-09-21T04:00:00Z'))).toEqual([])
  })
})

describe('how the times read', () => {
  it('says Today and Tomorrow rather than naming the weekday', () => {
    const slots = callbackSlots(hours(), at('2026-09-21T04:30:00Z'))
    const labels = slots.map((s) => s.label)
    expect(labels.some((l) => l.startsWith('Today') || l.startsWith('Tomorrow'))).toBe(true)
  })

  it('names the weekday once it is further out', () => {
    // Friday evening on a week that is shut at the weekend: the next
    // slot is Monday, and "in 3 days" would make somebody count.
    const fiveDay = hours({
      sat: { mode: 'off', from: '09:00', to: '18:00' },
      sun: { mode: 'off', from: '09:00', to: '18:00' },
    })
    const slots = callbackSlots(fiveDay, at('2026-09-25T15:00:00Z'))
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].label.startsWith('Monday')).toBe(true)
  })

  it('reads clock times the way this country does', () => {
    for (const s of callbackSlots(hours(), at('2026-09-21T01:00:00Z'))) {
      expect(s.label).toMatch(/\d{1,2}:\d{2} (AM|PM)$/)
    }
  })

  it('gives every slot an id that carries the moment itself', () => {
    // The id used to encode "days ahead, at this time", which only
    // means anything relative to when it was sent — so a tap after
    // midnight resolved to the wrong day. An absolute instant cannot
    // drift however long the customer takes to answer.
    const slots = callbackSlots(hours(), at('2026-09-21T01:00:00Z'))
    for (const s of slots) {
      expect(s.id).toMatch(/^cb_\d+$/)
      expect(Number(s.id.slice(3))).toBe(s.at.getTime())
    }
    expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length)
  })
})

describe('a zone that changes its clocks', () => {
  /** New York, 09:00–17:00 weekdays, open Saturday morning. */
  const newYork = (): WorkingHours => ({
    timezone: 'America/New_York',
    week: {
      ...DEFAULT_WEEK,
      mon: { mode: 'full', from: '09:00', to: '17:00' },
      tue: { mode: 'full', from: '09:00', to: '17:00' },
      wed: { mode: 'full', from: '09:00', to: '17:00' },
      thu: { mode: 'full', from: '09:00', to: '17:00' },
      fri: { mode: 'full', from: '09:00', to: '17:00' },
      sat: { mode: 'half', from: '09:00', to: '13:00' },
      sun: { mode: 'off', from: '09:00', to: '17:00' },
    },
  })

  const hourIn = (d: Date, zone: string) =>
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(d),
    )

  const dayIn = (d: Date, zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)

  it('lands on the right wall-clock hour across the spring change', () => {
    // 2026-03-08 is when New York loses an hour. Adding 24-hour blocks
    // instead of advancing the calendar date puts every slot an hour
    // out, which is exactly the kind of wrong nobody notices until a
    // customer says nobody rang.
    const friday = at('2026-03-06T20:00:00Z') // Fri 3pm New York
    for (const s of callbackSlots(newYork(), friday)) {
      const h = hourIn(s.at, 'America/New_York')
      expect(h).toBeGreaterThanOrEqual(9)
      expect(h).toBeLessThan(17)
    }
  })

  it('lands on the right wall-clock hour across the autumn change', () => {
    // 2026-11-01, when the day is 25 hours long.
    const friday = at('2026-10-30T19:00:00Z') // Fri 3pm New York
    for (const s of callbackSlots(newYork(), friday)) {
      const h = hourIn(s.at, 'America/New_York')
      expect(h).toBeGreaterThanOrEqual(9)
      expect(h).toBeLessThan(17)
    }
  })

  it('advances one calendar day at a time, not one 24-hour block', () => {
    // The invariant that breaks when days are counted in hours: the day
    // whose shift was read and the day the timestamp lands on have to
    // be the same day. Across the 23-hour day they drift apart, and the
    // callback gets offered for a moment the rota never approved.
    //
    // Asserted as "every slot is inside its own day's shift" rather
    // than as a fixed list of dates, because which days get used
    // depends on how many slots each one yields — and that is not what
    // this test is about.
    const rota = newYork()
    const saturday = at('2026-03-07T18:00:00Z') // Sat 1pm New York
    const slots = callbackSlots(rota, saturday)
    expect(slots.length).toBeGreaterThan(0)

    // It must have moved past Saturday afternoon and Sunday.
    const days = [...new Set(slots.map((s) => dayIn(s.at, 'America/New_York')))]
    expect(days.every((d) => d >= '2026-03-09')).toBe(true)

    const shiftFor: Record<string, [number, number] | null> = {
      Mon: [9, 17], Tue: [9, 17], Wed: [9, 17], Thu: [9, 17], Fri: [9, 17],
      Sat: [9, 13], Sun: null,
    }
    for (const s of slots) {
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
      }).format(s.at)
      const shift = shiftFor[weekday]
      expect(shift).not.toBeNull()
      const h = hourIn(s.at, 'America/New_York')
      expect(h).toBeGreaterThanOrEqual(shift![0])
      expect(h).toBeLessThan(shift![1])
    }
  })

  it('never offers a time on a day the business is shut', () => {
    const sunday = at('2026-11-01T15:00:00Z')
    for (const s of callbackSlots(newYork(), sunday)) {
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
      }).format(s.at)
      expect(weekday).not.toBe('Sun')
    }
  })
})

describe('local times that do not exist', () => {
  // America/New_York springs forward on 8 March 2026: 01:59 is followed
  // straight by 03:00, so nothing between them happens at all.
  //
  // A rota opening at 01:00 puts its "an hour after opening" candidate
  // at exactly 02:00 — a time the clock skips. The old correction
  // landed on 03:00 and labelled it "2:00 AM", which is a promise to
  // ring an hour before the business could.
  const graveyard: WorkingHours = {
    timezone: 'America/New_York',
    week: {
      mon: { mode: 'full', from: '01:00', to: '05:00' },
      tue: { mode: 'full', from: '01:00', to: '05:00' },
      wed: { mode: 'full', from: '01:00', to: '05:00' },
      thu: { mode: 'full', from: '01:00', to: '05:00' },
      fri: { mode: 'full', from: '01:00', to: '05:00' },
      sat: { mode: 'full', from: '01:00', to: '05:00' },
      sun: { mode: 'full', from: '01:00', to: '05:00' },
    },
  }

  it('never offers a label the clock will not show', () => {
    // Saturday 7 March 2026, 06:00 New York — so tomorrow is the day
    // the hour disappears.
    const now = new Date('2026-03-07T11:00:00Z')
    const slots = callbackSlots(graveyard, now)

    expect(slots.length).toBeGreaterThan(0)

    for (const slot of slots) {
      const shown = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      }).format(slot.at)

      // The label's clock time is what the zone actually reads at that
      // instant — never an hour adrift because of the jump.
      expect(slot.label).toContain(shown.replace(/\u202f/g, ' '))
    }
  })

  it('drops the skipped hour rather than sliding it', () => {
    const now = new Date('2026-03-07T11:00:00Z')
    const slots = callbackSlots(graveyard, now)

    // Sunday's 02:00 candidate does not exist, so no slot may land on
    // Sunday morning at the hour the clock skipped.
    const sundayTwo = slots.find((s) => s.label.startsWith('Tomorrow 2:'))
    expect(sundayTwo).toBeUndefined()
  })
})
