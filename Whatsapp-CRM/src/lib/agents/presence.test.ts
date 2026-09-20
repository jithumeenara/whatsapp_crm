import { describe, expect, it } from 'vitest'
import {
  presenceOf,
  isAvailable,
  shouldReleaseOnReturn,
  describeLastSeen,
  ONLINE_WITHIN_MS,
  AWAY_WITHIN_MS,
} from './presence'

const NOW = new Date('2026-09-20T12:00:00Z')
const agoMs = (ms: number) => new Date(NOW.getTime() - ms)
const minsAgo = (m: number) => agoMs(m * 60_000)

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
    expect(presenceOf(minsAgo(10), NOW)).toBe('away')
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

describe('isAvailable', () => {
  it('gives new work only to somebody who is actually here', () => {
    expect(isAvailable(minsAgo(1), NOW)).toBe(true)
    // "They were here twenty minutes ago" is not somebody answering.
    expect(isAvailable(minsAgo(20), NOW)).toBe(false)
    expect(isAvailable(null, NOW)).toBe(false)
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
    // They are coming back. Taking the thread off them would cost the
    // continuity the customer came back for.
    expect(shouldReleaseOnReturn(minsAgo(15), NOW)).toBe(false)
  })

  it('hands the thread back when the agent has gone', () => {
    // Otherwise the thread is owned by nobody present, the assistant
    // stays out of it on their behalf, and nobody answers at all.
    expect(shouldReleaseOnReturn(minsAgo(60), NOW)).toBe(true)
    expect(shouldReleaseOnReturn(minsAgo(60 * 24 * 3), NOW)).toBe(true)
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

  it('says so plainly when there is nothing to describe', () => {
    expect(describeLastSeen(null, NOW)).toBe('never signed in')
  })
})
