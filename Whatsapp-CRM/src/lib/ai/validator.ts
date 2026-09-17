/**
 * Checks a generated reply against the material it was supposed to come
 * from, before it is sent.
 *
 * The failure this prevents is the expensive one. A model that has no
 * fee list does not say "I don't know" — it produces a fluent, specific,
 * plausible number. The customer believes it, acts on it, and the
 * business finds out when they arrive expecting to pay it. Prompt
 * instructions ("never invent prices") reduce how often that happens and
 * cannot stop it, because the model is not consulting a rule when it
 * generates a digit.
 *
 * So this is a code check, not a prompt: every number, date, amount and
 * contact detail in the reply must appear in the context the model was
 * given. Anything that does not is unsupported, and an unsupported
 * figure is treated as a reason to hand over to a person rather than as
 * something to send and hope about.
 *
 * Deliberately narrow. It verifies *provenance*, not truth — it cannot
 * tell you the fee list is out of date, only that the reply did not
 * invent a number that was never in it. Broader checking belongs in the
 * evaluation suite, where it can be measured.
 */

export type ValidationIssue = {
  kind: 'number' | 'money' | 'date' | 'phone' | 'email' | 'url'
  value: string
  reason: string
}

export type ValidationResult = {
  ok: boolean
  issues: ValidationIssue[]
  /** One line suitable for a handoff note. Null when ok. */
  summary: string | null
}

/**
 * Numbers that carry no factual claim and would otherwise produce
 * constant false positives.
 *
 * Small integers are the main case: "2 or 3 days", "one of the 3
 * options", and every list the model numbers itself. Years within a
 * sensible window are allowed because a model saying "in 2026" when the
 * context says "this year" is not a fabrication worth a handoff.
 */
const CURRENT_YEAR = new Date().getFullYear()

function isBenignNumber(raw: string): boolean {
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n)) return true
  // Counts and small quantities.
  if (Number.isInteger(n) && n >= 0 && n <= 31) return true
  // Plausible years.
  if (Number.isInteger(n) && n >= CURRENT_YEAR - 2 && n <= CURRENT_YEAR + 3) return true
  // Times of day written as 10.30 / 9.45.
  return false
}

/** Everything the reply is allowed to draw on: retrieved knowledge, tool
 *  results, company profile, the customer's own message and the recent
 *  thread. Normalised once so comparisons are cheap and punctuation-
 *  insensitive. */
function normalizeCorpus(parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .join('\n')
    .toLowerCase()
    // Digit separators vary between the source and the reply: a context
    // saying "45,000" must satisfy a reply saying "45000", and the
    // Indian "45,000" / "45000" pair is the common case here.
    .replace(/[, \s]+/g, ' ')
}

function corpusHasNumber(corpus: string, raw: string): boolean {
  const bare = raw.replace(/[,\s]/g, '')
  if (corpus.replace(/\s/g, '').includes(bare)) return true
  // "45000" should also match a context that wrote "45 000" or "45,000".
  const spaced = bare.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return corpus.includes(spaced)
}

/**
 * Month name to number, for comparing a written date against a stored one.
 *
 * The case this exists for, from a live thread: the assistant wrote
 * "01 October 2026" and was refused, because the knowledge behind it was
 * a Data Store table holding that date as "2026-10-01". The word
 * "october" appears nowhere in a numeric date, so a check that looks for
 * the month by name declares a perfectly well-supported date invented.
 *
 * Worse, it fails silently in one direction only. The same reply's
 * "29 September 2026" passed — not because the check worked, but because
 * that table happens to carry a separate Month column reading
 * "september". One date in a sentence was accepted and the other
 * rejected, from the same row.
 */
const MONTH_NUMBERS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Whether the corpus contains this date written any of the usual ways.
 *
 * Deliberately generous about format and strict about the year. Both
 * orderings are accepted because a business writes 1/10/2026 and its
 * database stores 2026-10-01, and neither is wrong; but a day and month
 * with no year would match "1/10" appearing as a fraction or a ratio, so
 * when the reply states a year, the year has to be there too.
 */
function corpusHasNumericDate(
  corpus: string,
  day: string | undefined,
  monthAbbr: string | undefined,
  year: string | undefined,
): boolean {
  if (!monthAbbr || !day) return false
  const month = MONTH_NUMBERS[monthAbbr]
  if (!month) return false

  const dayForms = [String(Number(day)), String(Number(day)).padStart(2, '0')]
  const monthForms = [String(month), String(month).padStart(2, '0')]
  const candidates: string[] = []

  for (const d of dayForms) {
    for (const m of monthForms) {
      for (const sep of ['-', '/', '.']) {
        if (year) {
          candidates.push(`${d}${sep}${m}${sep}${year}`)
          candidates.push(`${m}${sep}${d}${sep}${year}`)
          candidates.push(`${year}${sep}${m}${sep}${d}`)
        } else {
          candidates.push(`${d}${sep}${m}`)
          candidates.push(`${m}${sep}${d}`)
        }
      }
    }
  }

  return candidates.some((c) => corpus.includes(c))
}

const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

/**
 * Validates one reply.
 *
 * `contextParts` must include everything the model could legitimately
 * have drawn the detail from — including the customer's own message,
 * since a customer quoting their own phone number back should not trip
 * the phone check.
 */
export function validateReply(args: {
  reply: string
  contextParts: (string | null | undefined)[]
}): ValidationResult {
  const reply = args.reply || ''
  const corpus = normalizeCorpus(args.contextParts)
  const issues: ValidationIssue[] = []

  const seen = new Set<string>()
  const flag = (kind: ValidationIssue['kind'], value: string, reason: string) => {
    const key = `${kind}:${value.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    issues.push({ kind, value, reason })
  }

  // ── Money ────────────────────────────────────────────────────
  // Checked before bare numbers so an amount is reported as money
  // rather than as a stray digit string.
  const moneyPattern = /(?:₹|rs\.?\s?|inr\s?)\s?([\d][\d,]*(?:\.\d{1,2})?)/gi
  for (const match of reply.matchAll(moneyPattern)) {
    const amount = match[1]
    if (!corpusHasNumber(corpus, amount)) {
      flag('money', match[0].trim(), 'This amount does not appear anywhere in the knowledge or lookups used for this reply.')
    }
  }

  // ── Phone numbers ────────────────────────────────────────────
  // 7+ consecutive digits, optionally +91-prefixed and spaced.
  for (const match of reply.matchAll(/(?:\+?\d{1,3}[\s-]?)?\d{5}[\s-]?\d{5}|\b\d{7,12}\b/g)) {
    const digits = match[0].replace(/\D/g, '')
    if (digits.length < 7) continue
    if (!corpus.replace(/\D/g, '').includes(digits)) {
      flag('phone', match[0].trim(), 'This phone number was not in the source material.')
    }
  }

  // ── Email + URLs ─────────────────────────────────────────────
  for (const match of reply.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) {
    if (!corpus.includes(match[0].toLowerCase())) {
      flag('email', match[0], 'This email address was not in the source material.')
    }
  }
  for (const match of reply.matchAll(/https?:\/\/[^\s)]+/gi)) {
    const url = match[0].replace(/[.,;]$/, '')
    // Compare on host — a context listing the site is enough to justify
    // a deeper path, and flagging every path would be noise.
    const host = /https?:\/\/([^/\s]+)/i.exec(url)?.[1]?.toLowerCase()
    if (host && !corpus.includes(host)) {
      flag('url', url, 'This link points somewhere not mentioned in the source material.')
    }
  }

  // ── Explicit dates ───────────────────────────────────────────
  const datePattern = new RegExp(
    `\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}(?:\\s+\\d{4})?|${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})\\b`,
    'gi',
  )
  for (const match of reply.matchAll(datePattern)) {
    const text = match[0].trim()
    // Match on the day+month pair rather than the exact string, so
    // "5 January" satisfies a context that wrote "5th January 2026".
    const day = /\d{1,2}/.exec(text)?.[0]
    const month = new RegExp(MONTHS, 'i').exec(text)?.[0]?.slice(0, 3).toLowerCase()
    const year = /\b(\d{4})\b/.exec(text)?.[1]
    const supported = month
      ? // The month by name, as before — or the same date written in
        // numbers, which is how a database stores it.
        (corpus.includes(month) && (!day || corpus.includes(day))) ||
        corpusHasNumericDate(corpus, day, month, year)
      : corpusHasNumber(corpus, text.replace(/\D/g, ''))
    if (!supported) {
      flag('date', text, 'This date does not appear in the knowledge or lookups used for this reply.')
    }
  }

  // ── Remaining bare numbers ───────────────────────────────────
  for (const match of reply.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) {
    const raw = match[0]
    if (isBenignNumber(raw)) continue
    // Already reported as money, a phone number or part of a date.
    if (issues.some((i) => i.value.includes(raw))) continue
    if (!corpusHasNumber(corpus, raw)) {
      flag('number', raw, 'This figure does not appear in the source material.')
    }
  }

  if (issues.length === 0) return { ok: true, issues: [], summary: null }

  return {
    ok: false,
    issues,
    summary: `Reply held ${issues.length} unsupported detail${issues.length === 1 ? '' : 's'}: ${issues
      .slice(0, 4)
      .map((i) => `${i.value} (${i.kind})`)
      .join(', ')}`,
  }
}
