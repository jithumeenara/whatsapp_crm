import { describe, expect, it } from 'vitest'
import { cleanPersonName, MAX_PERSON_NAME } from './person-name'

/**
 * A person's display name appears in lists, reports and PDFs. A member could
 * set their own to thousands of characters, and the PDF writer's work grows
 * with the square of a cell's length: 4,000 characters froze the server for
 * 75 seconds (found in security review). Names are cleaned and capped where
 * they are saved.
 */
describe('cleanPersonName', () => {
  it('keeps an ordinary name as it is, in any script', () => {
    for (const n of ['Asha K', 'ആശ ടീച്ചർ', 'محمد علي', 'Zoë Müller', 'जय कुमार']) expect(cleanPersonName(n)).toBe(n)
  })

  it('trims and collapses runs of spaces, line breaks and tabs', () => {
    expect(cleanPersonName('  Asha \n\t Kumar  ')).toBe('Asha Kumar')
  })

  it('removes control characters, including NUL and the bidi overrides', () => {
    expect(cleanPersonName('As\u0000ha\u0007')).toBe('Asha')
    expect(cleanPersonName('Asha \u202Eevil\u202C')).toBe('Asha evil')
  })

  it('caps the length', () => {
    expect(MAX_PERSON_NAME).toBeLessThanOrEqual(100)
    expect(cleanPersonName('x'.repeat(5000)).length).toBe(MAX_PERSON_NAME)
    expect(Array.from(cleanPersonName('ആ'.repeat(5000))).length).toBe(MAX_PERSON_NAME)
  })

  it('does not cut a letter in half (emoji and other characters outside the basic plane)', () => {
    const cut = cleanPersonName('😀'.repeat(500))
    expect(Array.from(cut).length).toBe(MAX_PERSON_NAME)
    expect(cut).not.toContain('�')
  })

  it('answers an empty string for nothing, and for what is only control characters', () => {
    expect(cleanPersonName('')).toBe('')
    expect(cleanPersonName('\u0000\n\t')).toBe('')
  })
})
