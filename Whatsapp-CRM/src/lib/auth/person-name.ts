/**
 * A person's display name, cleaned and capped where it is saved.
 *
 * Names appear in lists, reports and PDFs. One of 4,000 characters froze the
 * PDF build for 75 seconds (its cost grows with the square of a cell's
 * length), and nothing stopped a member setting their own. Control characters
 * (including the bidi overrides that can reorder what follows them) have no
 * place in a name either.
 */
export const MAX_PERSON_NAME = 100

// Control characters, and the direction overrides and isolates that reorder what
// follows them. Shared with the team name, the PDF writer and the sign-up check.
// eslint-disable-next-line no-control-regex
export const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/
const CONTROL = new RegExp(UNSAFE_NAME_CHARS.source, 'g')

export function cleanPersonName(raw: string): string {
  const spaced = String(raw ?? '').replace(/[\n\r\t]+/g, ' ')
  const clean = spaced.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  // By characters, not UTF-16 units, so nothing is cut in half.
  return Array.from(clean).slice(0, MAX_PERSON_NAME).join('').trim()
}
