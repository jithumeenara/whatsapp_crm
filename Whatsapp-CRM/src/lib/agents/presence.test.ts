import { describe, expect, it } from 'vitest'
import {
  presenceOf,
  isAvailable,
  shouldReleaseOnReturn,
  describeLastSeen,
  ONLINE_WITHIN_MS,
  AWAY_WITHIN_MS,
} from './presence'
import { IDLE_TIMEOUT_MS } from '@/lib/auth/session-timing'

const NOW = new Date('2026-09-20T12:00:00Z')
const agoMs = (ms: number) => new Date(NOW.getTime() - ms)
const minsAgo = (m: number) => agoMs(m * 60_000)

describe('the windows themselves', () => {
  // These are the assertions that actually keep the app honest. The
  // numbers are derived, so what is worth pinning is the relationship
  // they were derived from, not the values.

  it('never calls somebody present after their session has been destroyed', () => {
    // The whole bug this rule replaced: presence said "away" for twenty
    // minutes about people the proxy had already ejected.
    expect(AWAY_WITHIN_MS).toBeGreaterThan(IDLE_TIMEOUT_MS)
    expect(presenceOf(agoMs(IDLE_TIMEOUT_MS + 60_000), NOW)).toBe('offline')
  })

  it('does not call somebody offline while they might still be signed in', () => {
    // A heartbeat can be a throttle late, so a timestamp of exactly the
    // idle timeout ago may belong to somebody with seconds of session
    // left. Ejecting them early would be the opposite mistake.
    expect(presenceOf(agoMs(IDLE_TIMEOUT_MS), NOW)).toBe('away')
  })
})

describe('presenceOf', () => {
  it('counts somebody active in the last few minutes as online', () => {
    expect(presenceOf(minsAgo(0), NOW)).toBe('online')
    expect(presenceOf(minsAgo(2), NOW)).toBe('online')
  })

  it('tolerates one missed heartbeat', () => {
    // The heartbeat is throttled to once a minute, so a single dropped
    // beat must not read as somebody leaving the building.
    expect(presenceOf(agoMs(ONLINE_WITHIN_MS - 1), NOW)).toBe('online')
  })

  it('calls the gap between recent and gone "away", not one or the other', () => {
    expect(presenceOf(minsAgo(5), NOW)).toBe('away')
    expect(presenceOf(agoMs(AWAY_WITHIN_MS - 1), NOW)).toBe('away')
  })

  it('calls a long absence offline', () => {
    expect(presenceOf(agoMs(AWAY_WITHIN_MS), NOW)).toBe('offline')
    expect(presenceOf(minsAgo(60 * 9), NOW)).toBe('offline')
  })

  it('treats never having been seen as offline', () => {
    expect(presenceOf(null, NOW)).toBe('offline')
    expect(presenceOf(undefined, NOW)).toBe('offline')
  })

  it('does not mark a working agent offline over a clock disagreement', () => {
    // A timestamp slightly in the future is two machines disagreeing,
    // not a prediction. The costly mistake is calling them offline.
    expect(presenceOf(new Date(NOW.getTime() + 30_000), NOW)).toBe('online')
  })

  it('accepts a timestamp as a string, which is how it arrives from an API', () => {
    expect(presenceOf(minsAgo(1).toISOString(), NOW)).toBe('online')
  })

  it('is offline for something that is not a date at all', () => {
    expect(presenceOf('not a date', NOW)).toBe('offline')
  })
})

describe('leaving on purpose', () => {
  it('is offline the moment somebody signs out, not three minutes later', () => {
    // The point of recording the departure. Without it, an agent who
    // pressed Log out and walked away stayed green until the clock
    // caught up.
    expect(
      presenceOf({ last_seen_at: minsAgo(1), went_offline_at: minsAgo(0) }, NOW),
    ).toBe('offline')
  })

  it('is online again as soon as they come back, with nothing to clear', () => {
    // The departure is compared, not cleared — so the next heartbeat is
    // simply newer and wins. Nothing has to remember to undo it.
    expect(
      presenceOf({ last_seen_at: minsAgo(0), went_offline_at: minsAgo(30) }, NOW),
    ).toBe('online')
  })

  it('ignores a departure nobody has ever made', () => {
    expect(presenceOf({ last_seen_at: minsAgo(1), went_offline_at: null }, NOW)).toBe('online')
  })

  it('is offline for somebody who left and was never seen at all', () => {
    expect(presenceOf({ last_seen_at: null, went_offline_at: minsAgo(1) }, NOW)).toBe('offline')
  })

  it('still reads a bare timestamp, which is how most callers had it', () => {
    expect(presenceOf(minsAgo(1), NOW)).toBe('online')
  })
})

describe('isAvailable', () => {
  it('gives new work only to somebody who is actually here', () => {
    expect(isAvailable(minsAgo(1), NOW)).toBe(true)
    // "They were here twenty minutes ago" is not somebody answering.
    expect(isAvailable(minsAgo(20), NOW)).toBe(false)
    expect(isAvailable(null, NOW)).toBe(false)
  })

  it('does not hand work to somebody who has just signed out', () => {
    expect(isAvailable({ last_seen_at: minsAgo(0), went_offline_at: minsAgo(0) }, NOW)).toBe(false)
  })
})

describe('shouldReleaseOnReturn', () => {
  // The rule a reopened conversation asks for. Zendesk's routing does
  // not reassign a reopened ticket whose assignee is Online; it
  // reassigns based on that assignee's status. This is that rule.

  it('leaves the customer with an agent who is here', () => {
    expect(shouldReleaseOnReturn(minsAgo(1), NOW)).toBe(false)
  })

  it('leaves them with an agent who has merely stepped away', () => {
    // They are still signed in and coming back. Taking the thread off
    // them would cost the continuity the customer came back for.
    expect(shouldReleaseOnReturn(minsAgo(6), NOW)).toBe(false)
  })

  it('hands the thread back once the agent has been timed out', () => {
    // Past the idle timeout they are not "away" — the session is gone
    // and the next thing they see is the login page. Leaving the thread
    // with them means nobody answers at all.
    expect(shouldReleaseOnReturn(minsAgo(20), NOW)).toBe(true)
    expect(shouldReleaseOnReturn(minsAgo(60 * 24 * 3), NOW)).toBe(true)
  })

  it('hands it back immediately when the agent signed out', () => {
    expect(
      shouldReleaseOnReturn({ last_seen_at: minsAgo(0), went_offline_at: minsAgo(0) }, NOW),
    ).toBe(true)
  })

  it('hands it back when the owner has never been seen', () => {
    expect(shouldReleaseOnReturn(null, NOW)).toBe(true)
  })
})

describe('describeLastSeen', () => {
  it('reads the way a person would say it', () => {
    expect(describeLastSeen(minsAgo(0), NOW)).toBe('just now')
    expect(describeLastSeen(minsAgo(5), NOW)).toBe('5 min ago')
    expect(describeLastSeen(minsAgo(90), NOW)).toBe('1 hour ago')
    expect(describeLastSeen(minsAgo(60 * 5), NOW)).toBe('5 hours ago')
    expect(describeLastSeen(minsAgo(60 * 24 * 2), NOW)).toBe('2 days ago')
  })

  it('describes when they were last here, not when they left', () => {
    // Deliberate: the dot says they have gone, and this line says when
    // they were last at their desk. Two different facts.
    expect(
      describeLastSeen({ last_seen_at: minsAgo(5), went_offline_at: minsAgo(4) }, NOW),
    ).toBe('5 min ago')
  })

  it('says so plainly when there is nothing to describe', () => {
    expect(describeLastSeen(null, NOW)).toBe('never signed in')
  })
})
