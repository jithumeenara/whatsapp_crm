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

  it('gives every slot an id that survives the round trip', () => {
    // It comes back as a button reply and has to be matched to the
    // moment it stood for.
    const slots = callbackSlots(hours(), at('2026-09-21T01:00:00Z'))
    for (const s of slots) expect(s.id).toMatch(/^cb_\d+_\d+$/)
    expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length)
  })
})
