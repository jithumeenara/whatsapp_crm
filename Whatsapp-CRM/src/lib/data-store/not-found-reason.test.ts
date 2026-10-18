import { describe, expect, it } from 'vitest'
import { notFoundOutcome } from './contact-rows'

/**
 * Bug (18 Oct 2026): "Only rows saved for this chat" was ticked on a step
 * whose table came from a sheet. Those rows were never saved by a chat, so
 * every run ended "No row matched" — while the builder's Test (which
 * ignored the box) found the row. Nothing said why. With "Create a new
 * row" chosen it would also have made a duplicate for a person who
 * already has one.
 */
describe('when nothing matched', () => {
  it('says the rows exist but were not saved by this chat — and never creates a duplicate', () => {
    const r = notFoundOutcome({ onlyThisChat: true, matchedIgnoringChat: 1, createIfMissing: true })
    expect(r.create).toBe(false)
    expect(r.reason).toMatch(/1 row matched.*not saved by this chat/i)
    expect(r.reason).toMatch(/Only rows saved for this chat/)
  })

  it('creates the row when nobody has one at all', () => {
    expect(notFoundOutcome({ onlyThisChat: true, matchedIgnoringChat: 0, createIfMissing: true })).toEqual({ create: true, reason: null })
    expect(notFoundOutcome({ onlyThisChat: false, matchedIgnoringChat: 0, createIfMissing: false })).toEqual({ create: false, reason: null })
  })
})
