import { describe, expect, it } from 'vitest'
import { retrievalHit } from './runner'
import { STARTER_CASES } from './starter-cases'

/**
 * A test can say which knowledge the answer should come from; the run then
 * tells "never found it" (search) from "found it, answered wrong" (reply).
 */
describe('retrievalHit', () => {
  it('no expected source: not scored', () => {
    expect(retrievalHit(null, ['Price list'])).toBeNull()
    expect(retrievalHit('  ', ['Price list'])).toBeNull()
  })

  it('matches part of a title, ignoring case and spacing', () => {
    expect(retrievalHit('price  list', ['Opening hours', 'Price List 2026 (updated)'])).toBe(true)
  })

  it('a reply that used other knowledge, or none, is a miss', () => {
    expect(retrievalHit('Price list', ['Opening hours'])).toBe(false)
    expect(retrievalHit('Price list', [])).toBe(false)
  })
})

describe('starter cases work for any business', () => {
  it('no question assumes an institute or a course', () => {
    const text = STARTER_CASES.map((c) => c.question).join(' ').toLowerCase()
    for (const word of ['course', 'student', 'institute', 'batch', 'hostel', 'placement']) {
      expect(text).not.toContain(word)
    }
  })
})
