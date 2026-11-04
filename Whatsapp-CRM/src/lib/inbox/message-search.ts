/**
 * Inbox message search: the parts with no database in them, so they are
 * tested on their own (message-search.test.ts).
 */

export const MIN_QUERY = 2
export const MAX_QUERY = 100
export const MAX_RESULTS = 30

const SNIPPET_BEFORE = 40
const SNIPPET_LENGTH = 140

/** The text as an ILIKE "contains" pattern: %, _ and \ typed by a person
 *  mean themselves. Use with ESCAPE '\'. */
export function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** A short one-line piece of the text around the first match. Email bodies
 *  can hold markup, so tags are dropped first. Only ever rendered as text. */
export function messageSnippet(text: string | null | undefined, query: string): string {
  const flat = (text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (flat.length <= SNIPPET_LENGTH) return flat
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  const start = at <= SNIPPET_BEFORE ? 0 : at - SNIPPET_BEFORE
  const piece = flat.slice(start, start + SNIPPET_LENGTH)
  return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET_LENGTH < flat.length ? '…' : ''}`
}

/** Splits text so the matched parts can be marked. Case-insensitive; the
 *  query is plain text, never a pattern. */
export function splitOnMatch(text: string, query: string): Array<{ text: string; match: boolean }> {
  const q = query.trim().toLowerCase()
  if (!q) return [{ text, match: false }]
  const lower = text.toLowerCase()
  // Lower-casing can change a string's length; marking would then be off.
  if (lower.length !== text.length) return [{ text, match: false }]
  const parts: Array<{ text: string; match: boolean }> = []
  let from = 0
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false })
    parts.push({ text: text.slice(at, at + q.length), match: true })
    from = at + q.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts
}
