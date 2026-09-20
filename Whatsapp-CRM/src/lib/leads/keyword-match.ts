/**
 * Matching what a customer typed against words a business chose.
 *
 * ── Why four modes and not one ──────────────────────────────────────
 *
 * "Keyword" is one word doing four different jobs, and every CRM that
 * offers only one of them is wrong for somebody:
 *
 *   exact    the whole message is that word. For a menu reply — "1",
 *            "YES", "STOP" — where `contains` would fire on "yes I
 *            already did that, stop asking".
 *   word     the word appears, on its own. This is the one people mean
 *            by "keyword" and almost never get, because a substring
 *            search for "art" matches "start", "party" and "Bharat".
 *   contains anywhere at all, including inside another word. Right for
 *            a product code or a fragment.
 *   similar  close enough, allowing for how people actually type —
 *            "admision", "addmission", "admisssion", "fee's". This is
 *            the mode that stops a rule quietly failing on a Tuesday
 *            because somebody's thumb slipped.
 *
 * ── Why similarity is Dice over bigrams and not edit distance ───────
 *
 * Levenshtein counts single-character operations, which makes it
 * expensive on long strings and — the real problem — punishing about
 * word order: "fees course" and "course fees" are nearly as far apart
 * by edit distance as two unrelated phrases, and identical in meaning.
 * Sørensen–Dice over character bigrams is O(n), scores that pair 0.89
 * (a reorder costs only the bigrams either side of the join, not the
 * whole phrase), and degrades gracefully on the transpositions and
 * doubled letters that make up most real typing errors.
 *
 * The comparison runs over a sliding window of the message the same
 * length as the phrase, because comparing a two-word phrase against a
 * fifty-word message dilutes any real match to nothing — a whole
 * message Dice score would put "what are the admission fees" and a long
 * complaint that happens to mention fees at the same distance.
 *
 * ── Why the script matters here ─────────────────────────────────────
 *
 * This runs against Malayalam and romanized Malayalam as much as
 * English, so normalisation strips diacritics and punctuation but never
 * assumes a Latin alphabet, and the word splitter uses whitespace
 * rather than a letter class. `[a-z]` would treat an entire Malayalam
 * sentence as one token.
 */

export type MatchMode = 'exact' | 'word' | 'contains' | 'similar'

/** Sørensen–Dice, 0..1. 0.8 is where "admision"/"admission" and
 *  "addmission"/"admission" both land, and where genuinely different
 *  words reliably do not — "admission"/"submission" scores 0.71. */
export const DEFAULT_SIMILARITY = 0.8

/**
 * Lowercase, drop punctuation, fold accents, collapse whitespace.
 *
 * NFD then stripping the combining range removes Latin accents without
 * touching Malayalam, whose vowel signs are not in that block and are
 * part of the word rather than decoration on it.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,!?;:'"`’‘“”()\[\]{}\-_/\\|@#$%^&*+=~<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(text: string): string[] {
  return text.length === 0 ? [] : text.split(' ')
}

function bigrams(text: string): Map<string, number> {
  const out = new Map<string, number>()
  // Spaces removed, so a reorder costs only the two bigrams either side
  // of the join rather than realigning the whole phrase.
  const compact = text.replace(/\s+/g, '')
  for (let i = 0; i < compact.length - 1; i += 1) {
    const pair = compact.slice(i, i + 2)
    out.set(pair, (out.get(pair) ?? 0) + 1)
  }
  return out
}

/** 0..1. Two strings of one character each can produce no bigrams, so
 *  those fall back to plain equality rather than scoring 0. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const first = bigrams(a)
  const second = bigrams(b)
  if (first.size === 0 || second.size === 0) return 0

  let shared = 0
  for (const [pair, count] of first) {
    const other = second.get(pair)
    if (other) shared += Math.min(count, other)
  }
  const total = [...first.values()].reduce((n, v) => n + v, 0) +
    [...second.values()].reduce((n, v) => n + v, 0)
  return (2 * shared) / total
}

export interface MatchOptions {
  mode: MatchMode
  /** Only for 'similar'. Clamped to a sane band — a threshold of 0.2
   *  matches everything and is never what somebody meant to type. */
  threshold?: number
  caseSensitive?: boolean
}

export interface MatchHit {
  keyword: string
  /** What in the message matched. Shown back to the account so a rule
   *  that fires on the wrong thing can be seen to have done so. */
  matched: string
  /** 1 for the exact modes. The real score for 'similar'. */
  score: number
}

/**
 * The first keyword that matches, or null.
 *
 * First rather than best: a rule with a list of keywords is a list of
 * synonyms, and which synonym matched changes nothing about what
 * happens next. Stopping early also means a long list costs nothing on
 * the common case.
 */
export function matchKeywords(
  message: string,
  keywords: string[],
  options: MatchOptions,
): MatchHit | null {
  const threshold = Math.min(0.99, Math.max(0.5, options.threshold ?? DEFAULT_SIMILARITY))
  const haystack = options.caseSensitive ? message.trim() : normalize(message)
  if (!haystack) return null
  const messageWords = words(haystack)

  for (const raw of keywords) {
    const needle = options.caseSensitive ? raw.trim() : normalize(raw)
    if (!needle) continue

    switch (options.mode) {
      case 'exact':
        if (haystack === needle) return { keyword: raw, matched: haystack, score: 1 }
        break

      case 'contains':
        if (haystack.includes(needle)) return { keyword: raw, matched: needle, score: 1 }
        break

      case 'word': {
        // Whitespace-delimited rather than \b, which is defined in terms
        // of [A-Za-z0-9_] and therefore treats every Malayalam letter as
        // a boundary — making every match succeed.
        const needleWords = words(needle)
        const span = needleWords.length
        for (let i = 0; i + span <= messageWords.length; i += 1) {
          if (messageWords.slice(i, i + span).join(' ') === needle) {
            return { keyword: raw, matched: needle, score: 1 }
          }
        }
        break
      }

      case 'similar': {
        const span = words(needle).length
        // A window the length of the phrase, and one word either side,
        // so "admission fee" still matches "the admission fees are".
        for (let width = Math.max(1, span - 1); width <= span + 1; width += 1) {
          for (let i = 0; i + width <= messageWords.length; i += 1) {
            const window = messageWords.slice(i, i + width).join(' ')
            const score = similarity(window, needle)
            if (score >= threshold) {
              return { keyword: raw, matched: window, score: Math.round(score * 100) / 100 }
            }
          }
        }
        break
      }
    }
  }

  return null
}

export const MATCH_MODE_LABELS: Record<MatchMode, { label: string; hint: string }> = {
  word: {
    label: 'Contains the word',
    hint: 'The word appears on its own. "art" will not match "start".',
  },
  contains: {
    label: 'Contains the text anywhere',
    hint: 'Including inside another word. Good for codes and fragments.',
  },
  exact: {
    label: 'The whole message is this',
    hint: 'For one-word replies like YES or a menu number.',
  },
  similar: {
    label: 'Something similar',
    hint: 'Allows for typos and word order — "admision", "fees course".',
  },
}

export function normalizeMatchMode(value: unknown): MatchMode {
  return value === 'exact' || value === 'contains' || value === 'similar'
    ? value
    : 'word'
}
