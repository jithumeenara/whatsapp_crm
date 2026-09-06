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
 */
export function classifyMetaErrorCode(code?: number, subcode?: number): MetaErrorCategory {
  if (code === 190) return 'auth_expired'
  if (code === 131056 || code === 130429 || code === 131048 || code === 80007) return 'rate_limited'
  if (code === 131026 || code === 131030) return 'recipient_unreachable'
  if (code === 131050) return 'recipient_opted_out'
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
