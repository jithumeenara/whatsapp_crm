/**
 * Which failed recipients a "Retry failed" may send to again.
 *
 * Not all failures are worth a second try: a number not on WhatsApp, a
 * person who opted out and a template Meta refuses fail the same way every
 * time, and Meta's per-person marketing limit (131049) asks for a day's
 * wait — retrying it at once just fails again and counts against the
 * number's quality.
 */

import { classifyMetaError, retryRule } from '@/lib/whatsapp/meta-error-codes'

export interface FailedRow {
  id: string
  error_message: string | null
  sent_at: Date | null
  created_at: Date
}

export interface RetryPick {
  retry: string[]
  skipped: { cannot_receive: number; template: number; too_soon: number }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Failures recorded before a send was attempted (run-broadcast.ts). */
const NOT_A_NUMBER = /^(No phone number on contact|Invalid phone number format)/

export function pickRetryable(rows: readonly FailedRow[], now: Date = new Date()): RetryPick {
  const pick: RetryPick = { retry: [], skipped: { cannot_receive: 0, template: 0, too_soon: 0 } }
  for (const r of rows) {
    const text = r.error_message ?? ''
    if (NOT_A_NUMBER.test(text)) {
      pick.skipped.cannot_receive++
      continue
    }
    const { category } = classifyMetaError(text)
    const rule = retryRule(category)
    if (rule === 'never') {
      if (category === 'template_problem') pick.skipped.template++
      else pick.skipped.cannot_receive++
      continue
    }
    if (rule === 'after_24h') {
      const at = (r.sent_at ?? r.created_at).getTime()
      if (now.getTime() - at < DAY_MS) {
        pick.skipped.too_soon++
        continue
      }
    }
    pick.retry.push(r.id)
  }
  return pick
}
