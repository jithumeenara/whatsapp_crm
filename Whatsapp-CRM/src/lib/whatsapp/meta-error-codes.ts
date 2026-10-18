/**
 * Classifies a Meta Graph API error into one of a small set of categories
 * that callers actually need to branch on — instead of every catch block
 * regex-sniffing the error message string for its own private list of
 * magic numbers (which is what this codebase did before this file existed:
 * see the old isRateLimitError in run-broadcast.ts and
 * isRecipientNotAllowedError in phone-utils.ts, both string-based).
 *
 * throwMetaError() in meta-api.ts already embeds the numeric code in every
 * thrown message as `(code X.Y)` — classifyMetaError() below regexes that
 * back out, so any existing call site that only ever sees `err.message`
 * (which is all of them today) can adopt this with zero signature changes.
 */

export type MetaErrorCategory =
  | 'auth_expired'
  | 'rate_limited'
  | 'recipient_unreachable'
  | 'recipient_opted_out'
  | 'marketing_limit'
  | 'template_problem'
  | 'unknown'

export interface ClassifiedMetaError {
  category: MetaErrorCategory
  code?: number
  subcode?: number
  message: string
}

/**
 * Meta's stable error-code taxonomy, as documented at
 * developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 *
 *   190              — access token expired/invalid. Nothing else this
 *                       run does will succeed either — the whole run
 *                       should stop, not just this one recipient.
 *   131056, 130429,
 *   131048, 80007    — rate limited. Retryable with backoff.
 *   131026, 131030   — recipient unreachable / not a WhatsApp user /
 *                       not in the allowed list (sandbox restriction).
 *                       Only this one recipient is affected.
 *   131050           — recipient has opted out of marketing messages.
 *                       Only this one recipient is affected.
 *   131049           — Meta held back a marketing message: this person
 *                       already got their share from businesses. Not a
 *                       fault; retry no sooner than a day later.
 *   132000–132069    — the template itself (missing, paused, wrong
 *                       parameters, rejected). Fix the template; a retry
 *                       of the same send fails the same way.
 */
export function classifyMetaErrorCode(code?: number, subcode?: number): MetaErrorCategory {
  if (code === 190) return 'auth_expired'
  if (code === 131056 || code === 130429 || code === 131048 || code === 80007) return 'rate_limited'
  if (code === 131026 || code === 131030) return 'recipient_unreachable'
  if (code === 131050) return 'recipient_opted_out'
  if (code === 131049) return 'marketing_limit'
  if (code !== undefined && code >= 132000 && code <= 132069) return 'template_problem'
  void subcode // reserved for future finer-grained classification
  return 'unknown'
}

const CODE_PATTERN = /\(code (\d+)(?:\.(\d+))?\)/

/**
 * Extracts the `(code X.Y)` suffix throwMetaError() embeds in every
 * thrown message and classifies it. Falls back to 'unknown' (code
 * undefined) for messages that never went through throwMetaError, or
 * whose response body wasn't JSON (throwMetaError's own fallback path).
 */
export function classifyMetaError(message: string): ClassifiedMetaError {
  const match = CODE_PATTERN.exec(message)
  const code = match ? Number(match[1]) : undefined
  const subcode = match?.[2] ? Number(match[2]) : undefined
  return {
    category: classifyMetaErrorCode(code, subcode),
    code,
    subcode,
    message,
  }
}

/** What a "Retry failed" may do with a recipient that failed this way. */
export type RetryRule = 'now' | 'after_24h' | 'never'

export function retryRule(category: MetaErrorCategory): RetryRule {
  if (category === 'recipient_unreachable' || category === 'recipient_opted_out' || category === 'template_problem') return 'never'
  if (category === 'marketing_limit') return 'after_24h'
  return 'now'
}

/**
 * The reason for a failure Meta reports later (a status webhook's
 * `errors`), in the same "… (code X)" form a failed send carries, so one
 * classifier reads both.
 */
export function failureText(errors: ReadonlyArray<{ code?: number; title?: string; message?: string }> | undefined): string {
  const e = errors?.[0]
  if (!e || (e.code === undefined && !e.title && !e.message)) return 'Not delivered (WhatsApp gave no reason)'
  const words = (e.title || e.message || 'Not delivered').trim().slice(0, 300)
  return e.code !== undefined ? `${words} (code ${e.code})` : words
}
