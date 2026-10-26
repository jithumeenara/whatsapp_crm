import { describe, expect, it } from 'vitest'
import { isLegacyStartPayload, signStartPayload, START_LINK_DAYS, verifyStartPayload } from './links'

// A start link never expired: anyone who got hold of one (forwarded, in a
// screenshot) could press Start and have their Telegram joined to that
// contact's record at any time later.
const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
const DAY = 86_400_000

describe('Telegram start links expire', () => {
  it('works on the day it is made and within its days', () => {
    const now = Date.UTC(2026, 9, 26)
    const p = signStartPayload(id, 's', now)
    expect(p.length).toBeLessThanOrEqual(64)
    expect(verifyStartPayload(p, 's', now)).toBe(id)
    expect(verifyStartPayload(p, 's', now + START_LINK_DAYS * DAY)).toBe(id)
  })

  it('stops working after that', () => {
    const now = Date.UTC(2026, 9, 26)
    const p = signStartPayload(id, 's', now)
    expect(verifyStartPayload(p, 's', now + (START_LINK_DAYS + 1) * DAY)).toBeNull()
  })

  it('a changed day breaks the signature', () => {
    const now = Date.UTC(2026, 9, 26)
    const p = signStartPayload(id, 's', now)
    const forged = p.slice(0, 33) + 'zzzz' + p.slice(37)
    expect(verifyStartPayload(forged, 's', now)).toBeNull()
  })

  it('new links are not legacy ones', () => {
    expect(isLegacyStartPayload(signStartPayload(id, 's'))).toBe(false)
  })
})
