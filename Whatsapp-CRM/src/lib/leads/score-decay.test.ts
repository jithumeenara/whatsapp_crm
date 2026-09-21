import { describe, expect, it } from 'vitest'
import { decayScore, quietDays, describeDecay, DECAY_STEPS } from './score-decay'

const NOW = new Date('2026-09-21T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

const LADDER = ['Hot', 'Warm', 'Cold']

const decay = (score: string, days: number | null, ladder = LADDER) =>
  decayScore(
    { score, lastCustomerAt: days === null ? null : daysAgo(days), ladder },
    NOW,
  )

describe('a score fades when the customer goes quiet', () => {
  it('leaves a fresh lead exactly as somebody set it', () => {
    const r = decay('Hot', 3)
    expect(r.effective).toBe('Hot')
    expect(r.dropped).toBe(0)
  })

  it('does not move in the first fortnight', () => {
    // Waiting on a salary, a result or a family decision is normal and
    // is not cooling. Demoting somebody in week one would make the
    // fading itself untrustworthy.
    expect(decay('Hot', 13).effective).toBe('Hot')
    expect(decay('Hot', 29).effective).toBe('Hot')
  })

  it('drops one level after a month', () => {
    const r = decay('Hot', 31)
    expect(r.effective).toBe('Warm')
    expect(r.dropped).toBe(1)
  })

  it('drops two after two months', () => {
    expect(decay('Hot', 61).effective).toBe('Cold')
  })

  it('cannot fall off the bottom of the ladder', () => {
    // Three steps down from Hot on a three-rung ladder is still Cold,
    // not an undefined level the filters would never match.
    const r = decay('Hot', 400)
    expect(r.effective).toBe('Cold')
    expect(r.dropped).toBe(2)
  })

  it('leaves something already at the bottom alone', () => {
    const r = decay('Cold', 400)
    expect(r.effective).toBe('Cold')
    expect(r.dropped).toBe(0)
  })
})

describe('what a person set is never lost', () => {
  it('reports both, always', () => {
    // The stored score keeps saying what somebody decided. An agent who
    // marked this Hot after a phone call knows something this file does
    // not, and overwriting their judgement would be a feature they came
    // to resent.
    const r = decay('Hot', 65)
    expect(r.set).toBe('Hot')
    expect(r.effective).toBe('Cold')
  })
})

describe('when it refuses to fade anything', () => {
  it('says nothing when nobody knows the last contact', () => {
    // Usually a lead created before this was recorded. Silence about a
    // fact beats inventing one.
    const r = decay('Hot', null)
    expect(r.effective).toBe('Hot')
    expect(r.quietDays).toBeNull()
  })

  it('leaves a score that is not on this account\'s ladder', () => {
    // An account that renamed its levels after leads were scored would
    // otherwise see every old lead jump straight to the coldest rung.
    expect(decay('Blazing', 400).effective).toBe('Blazing')
  })

  it('does nothing with a ladder too short to step down', () => {
    expect(decay('Hot', 400, ['Hot']).effective).toBe('Hot')
    expect(decay('Hot', 400, []).effective).toBe('Hot')
  })

  it('matches the ladder whatever the capitalisation', () => {
    expect(decay('hot', 31, LADDER).effective).toBe('Warm')
    expect(decay('  Hot  ', 31, LADDER).effective).toBe('Warm')
  })
})

describe("an account with its own levels", () => {
  const ownLadder = ['Very interested', 'Interested', 'Maybe', 'Gone quiet']

  it('steps down that list, not Hot/Warm/Cold', () => {
    expect(decay('Very interested', 31, ownLadder).effective).toBe('Interested')
    expect(decay('Very interested', 61, ownLadder).effective).toBe('Maybe')
    expect(decay('Very interested', 400, ownLadder).effective).toBe('Gone quiet')
  })

  it('uses the extra rung a four-level ladder has', () => {
    // On three rungs the deepest fall is two; on four it is three.
    expect(decay('Very interested', 400, ownLadder).dropped).toBe(3)
  })
})

describe('counting the silence', () => {
  it('counts whole days', () => {
    expect(quietDays(daysAgo(5), NOW)).toBe(5)
    expect(quietDays(daysAgo(0), NOW)).toBe(0)
  })

  it('reads a timestamp from the future as zero', () => {
    // Two clocks disagreeing must not be able to make a lead hotter
    // than it is.
    expect(quietDays(new Date(NOW.getTime() + 60_000), NOW)).toBe(0)
  })

  it('takes a string, which is how it arrives from an API', () => {
    expect(quietDays(daysAgo(10).toISOString(), NOW)).toBe(10)
  })

  it('is null for nothing, and for nonsense', () => {
    expect(quietDays(null, NOW)).toBeNull()
    expect(quietDays('not a date', NOW)).toBeNull()
  })
})

describe('explaining itself', () => {
  it('says nothing when nothing faded', () => {
    // No tooltip on an unchanged score — a note explaining that nothing
    // happened is noise on every row.
    expect(describeDecay(decay('Hot', 3))).toBeNull()
  })

  it('names the score somebody set and how long it has been quiet', () => {
    // A score that changed on its own with no explanation is the kind
    // of thing people file a bug about, and distrust afterwards even
    // once it is explained.
    const text = describeDecay(decay('Hot', 35))!
    expect(text).toContain('Set to Hot')
    expect(text).toContain('weeks')
  })

  it('switches to months once weeks stop being readable', () => {
    expect(describeDecay(decay('Hot', 70))).toContain('months')
  })
})

describe('the thresholds themselves', () => {
  it('are ordered longest-first, so the first match is the deepest fall', () => {
    // Read in order and the first hit wins. Sorted the other way, a
    // year-old lead would only ever drop one level.
    const days = DECAY_STEPS.map((s) => s.afterDays)
    expect([...days].sort((a, b) => b - a)).toEqual(days)
  })

  it('never step up', () => {
    for (const rule of DECAY_STEPS) expect(rule.steps).toBeGreaterThan(0)
  })
})
