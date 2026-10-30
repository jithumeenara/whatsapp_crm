import { describe, expect, it } from 'vitest'
import { tokenIsIdle, tokenIsStale } from './session-guard'
import { IDLE_TIMEOUT_MS } from './session-timing'

/**
 * "Sign out everywhere", password resets and removing a member all work
 * by refusing any token issued before a moment. The check compared that
 * moment with the token's `iat` — but every re-sign of the cookie (POST
 * /api/heartbeat, NextAuth's own refresh) stamps a NEW `iat`. A stolen
 * cookie kept warm by heartbeats came back with an `iat` after the
 * sign-out and sailed through; the same refresh also rolled the
 * "absolute" 8-hour limit forward for ever.
 *
 * The sign-in time is now its own claim (authTime) that no refresh
 * changes, and both checks read it.
 */

const H = 60 * 60

describe('refusing a session token', () => {
  const signedIn = 1_000_000 // seconds

  it('refuses a token from before "sign out everywhere", even after a refresh re-stamped its iat', () => {
    const signOutAt = new Date((signedIn + 60) * 1000)
    const refreshed = { authTime: signedIn, iat: signedIn + 120 }
    expect(tokenIsStale(refreshed, signOutAt, (signedIn + 130) * 1000)).toBe(true)
  })

  it('accepts a sign-in made after it', () => {
    const signOutAt = new Date((signedIn - 60) * 1000)
    expect(tokenIsStale({ authTime: signedIn, iat: signedIn + 600 }, signOutAt, (signedIn + 700) * 1000)).toBe(false)
  })

  it('ends every session 8 hours after sign-in, however often it was refreshed', () => {
    const token = { authTime: signedIn, iat: signedIn + 8 * H - 5 }
    expect(tokenIsStale(token, null, (signedIn + 8 * H - 10) * 1000)).toBe(false)
    expect(tokenIsStale(token, null, (signedIn + 8 * H + 1) * 1000)).toBe(true)
  })

  it('falls back to iat for a token issued before authTime existed', () => {
    expect(tokenIsStale({ iat: signedIn }, new Date((signedIn + 1) * 1000), (signedIn + 2) * 1000)).toBe(true)
    expect(tokenIsStale({ iat: signedIn }, null, (signedIn + 8 * H + 1) * 1000)).toBe(true)
  })
})

/**
 * Round 2: useSession().update() bumped lastActivity unconditionally, so
 * a token already past the 10-minute idle limit could be revived by one
 * update call instead of being refused (the proxy refuses it, but a
 * route reached another way would not). An idle token is now refused.
 */
describe('refreshing an idle token', () => {
  const now = 2_000_000_000_000
  it('is refused once idle', () => {
    expect(tokenIsIdle({ lastActivity: now - IDLE_TIMEOUT_MS - 1 }, now)).toBe(true)
  })
  it('is fine while active', () => {
    expect(tokenIsIdle({ lastActivity: now - 1000 }, now)).toBe(false)
  })
  it('falls back to the sign-in time for a token without lastActivity', () => {
    expect(tokenIsIdle({ authTime: (now - IDLE_TIMEOUT_MS - 5000) / 1000 }, now)).toBe(true)
  })
})

