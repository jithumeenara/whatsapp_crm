import { describe, expect, it } from 'vitest'
import {
  pickForOffer,
  isExpired,
  secondsLeft,
  shouldKeepOffering,
  describeGivingUp,
  DEFAULT_MAX_CONCURRENT,
  MAX_ROUNDS,
  type OfferCandidate,
} from './offer'

const NOW = new Date('2026-09-21T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

function agent(over: Partial<OfferCandidate> & { userId: string }): OfferCandidate {
  return {
    online: true,
    onShift: true,
    openConversations: 0,
    handles: [],
    lastSeenAt: minsAgo(1),
    ...over,
  }
}

const pick = (candidates: OfferCandidate[], over: Partial<Parameters<typeof pickForOffer>[0]> = {}) =>
  pickForOffer({ candidates, category: null, alreadyOffered: [], ...over })

describe('who can be offered anything at all', () => {
  it('skips somebody who is not signed in', () => {
    const r = pick([agent({ userId: 'away', online: false }), agent({ userId: 'here' })])
    expect(r.agent?.userId).toBe('here')
  })

  it('skips somebody outside their working hours', () => {
    // Being at your desk on a Sunday is genuinely online and genuinely
    // off duty. Handing them a customer is the same mistake as handing
    // one to somebody who has gone home.
    const r = pick([agent({ userId: 'sunday', onShift: false }), agent({ userId: 'weekday' })])
    expect(r.agent?.userId).toBe('weekday')
  })

  it('skips somebody already at the cap', () => {
    // A cap, not a target. Somebody on three is not offered a fourth
    // however idle they look on every other measure.
    const r = pick([
      agent({ userId: 'full', openConversations: DEFAULT_MAX_CONCURRENT, lastSeenAt: minsAgo(30) }),
      agent({ userId: 'busy', openConversations: 2 }),
    ])
    expect(r.agent?.userId).toBe('busy')
  })

  it('honours a cap the account set for itself', () => {
    const r = pick([agent({ userId: 'one', openConversations: 1 })], { maxConcurrent: 1 })
    expect(r.agent).toBeNull()
  })

  it('never offers the same conversation to somebody twice', () => {
    // They missed it a minute ago because they are at lunch, and they
    // will miss it again. Re-offering only costs the customer time.
    const r = pick([agent({ userId: 'missed' }), agent({ userId: 'fresh' })], {
      alreadyOffered: ['missed'],
    })
    expect(r.agent?.userId).toBe('fresh')
  })
})

describe('preferring somebody who knows the subject', () => {
  const team = [
    agent({ userId: 'dentist', handles: ['dental'], openConversations: 2 }),
    agent({ userId: 'generalist', handles: [], openConversations: 0 }),
  ]

  it('picks the specialist even when somebody else is freer', () => {
    const r = pick(team, { category: 'dental' })
    expect(r.agent?.userId).toBe('dentist')
    expect(r.outsideSpeciality).toBe(false)
  })

  it('goes outside the speciality rather than making the customer wait', () => {
    // A preference, not a wall. Holding a customer for the one person
    // who does Ortho while three others sit free is choosing tidiness
    // over the person waiting.
    const r = pick(team, { category: 'ortho' })
    expect(r.agent?.userId).toBe('generalist')
    expect(r.outsideSpeciality).toBe(true)
  })

  it('says so, so the agent knows why it reached them', () => {
    expect(pick(team, { category: 'ortho' }).reason).toContain('nobody free handles this subject')
  })

  it('ignores the speciality when the subject is unknown', () => {
    // The assistant says "unsure" rather than guessing between two
    // departments, and an unsure category must not route.
    const r = pick(team, { category: null })
    expect(r.agent?.userId).toBe('generalist')
    expect(r.outsideSpeciality).toBe(false)
  })

  it('does not treat a specialist who is unavailable as available', () => {
    const r = pick(
      [
        agent({ userId: 'dentist', handles: ['dental'], online: false }),
        agent({ userId: 'generalist' }),
      ],
      { category: 'dental' },
    )
    expect(r.agent?.userId).toBe('generalist')
    expect(r.outsideSpeciality).toBe(true)
  })
})

describe('choosing between people who could all take it', () => {
  it('gives it to whoever has fewest open', () => {
    const r = pick([
      agent({ userId: 'two', openConversations: 2 }),
      agent({ userId: 'none', openConversations: 0 }),
      agent({ userId: 'one', openConversations: 1 }),
    ])
    expect(r.agent?.userId).toBe('none')
  })

  it('breaks a tie on who has been idle longest', () => {
    // Otherwise two agents with nothing on both keep getting the next
    // one, and the fastest is punished for being fast.
    const r = pick([
      agent({ userId: 'just-finished', lastSeenAt: minsAgo(0) }),
      agent({ userId: 'waiting', lastSeenAt: minsAgo(20) }),
    ])
    expect(r.agent?.userId).toBe('waiting')
  })
})

describe('when nobody can take it, and why', () => {
  it('distinguishes nobody signed in', () => {
    const r = pick([agent({ userId: 'a', online: false })])
    expect(r.agent).toBeNull()
    expect(r.reason).toContain('nobody is signed in')
  })

  it('distinguishes everybody off shift', () => {
    // A rota to change, not a person to ring. Different action, so a
    // different sentence.
    const r = pick([agent({ userId: 'a', onShift: false })])
    expect(r.reason).toContain('outside their working hours')
  })

  it('distinguishes everybody at the cap', () => {
    const r = pick([agent({ userId: 'a', openConversations: 3 })])
    expect(r.reason).toContain('already on 3 conversations')
  })

  it('distinguishes having run out of people to ask', () => {
    const r = pick([agent({ userId: 'a' })], { alreadyOffered: ['a'] })
    expect(r.reason).toContain('already been offered')
  })

  it('copes with an account that has no agents at all', () => {
    const r = pick([])
    expect(r.agent).toBeNull()
  })
})

describe('the clock on an offer', () => {
  const offered = new Date('2026-09-21T12:00:00Z')
  const at = (s: number) => new Date(offered.getTime() + s * 1000)

  it('is alive before the time is up', () => {
    expect(isExpired(offered, 60, at(59))).toBe(false)
  })

  it('is over at the exact second', () => {
    expect(isExpired(offered, 60, at(60))).toBe(true)
  })

  it('counts down and stops at zero', () => {
    expect(secondsLeft(offered, 60, at(0))).toBe(60)
    expect(secondsLeft(offered, 60, at(45))).toBe(15)
    expect(secondsLeft(offered, 60, at(90))).toBe(0)
  })

  it('treats an unreadable timestamp as already over', () => {
    // A stuck offer is the worst outcome — the customer waits with
    // nothing on any screen saying so. Erring toward moving on.
    expect(isExpired('not a date', 60, NOW)).toBe(true)
    expect(secondsLeft('not a date', 60, NOW)).toBe(0)
  })
})

describe('when the ringing stops', () => {
  it('keeps going through the first round', () => {
    expect(shouldKeepOffering({ offered: ['a'], teamSize: 3 })).toBe(true)
  })

  it('keeps going through the second', () => {
    expect(shouldKeepOffering({ offered: ['a', 'b', 'c'], teamSize: 3 })).toBe(true)
  })

  it('stops after two rounds of the whole team', () => {
    // Four agents at lunch would otherwise mean four alarms a minute,
    // through the night, until people stop hearing alarms at all.
    expect(shouldKeepOffering({ offered: ['a', 'b', 'c', 'a', 'b', 'c'], teamSize: 3 })).toBe(false)
  })

  it('stops immediately when there is nobody to offer to', () => {
    expect(shouldKeepOffering({ offered: [], teamSize: 0 })).toBe(false)
  })

  it('rings twice as many times as there are people, by construction', () => {
    const teamSize = 5
    let offered: string[] = []
    let rings = 0
    while (shouldKeepOffering({ offered, teamSize })) {
      offered = [...offered, `a${rings % teamSize}`]
      rings += 1
    }
    expect(rings).toBe(teamSize * MAX_ROUNDS)
  })
})

describe('explaining why it stopped', () => {
  it('never reads as simply giving up', () => {
    const text = describeGivingUp({ offered: ['a', 'b'], teamSize: 2 }, 'nobody is signed in')
    expect(text).toContain('2 people')
    expect(text).toContain('nobody took it')
  })

  it('says why when nobody could be offered it at all', () => {
    const text = describeGivingUp({ offered: [], teamSize: 0 }, 'nobody is signed in right now')
    expect(text).toContain('nobody is signed in right now')
  })

  it('counts one person as a person', () => {
    expect(describeGivingUp({ offered: ['a'], teamSize: 1 }, '')).toContain('1 person')
  })
})
