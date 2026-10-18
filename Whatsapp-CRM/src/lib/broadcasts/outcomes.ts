/**
 * What happened to each person a broadcast went to — one group each.
 *
 * The groups are what a business acts on: who to remind, who to thank,
 * who to leave alone. Built from the per-recipient status the webhook keeps
 * (sent → delivered → read → replied, or failed with its reason).
 *
 * "Delivered, not opened" includes people who turned off read receipts —
 * WhatsApp never reports a read for them — and says so wherever it is shown.
 */

import { classifyMetaError } from '@/lib/whatsapp/meta-error-codes'

export const OUTCOMES = [
  'replied',
  'read_no_reply',
  'not_opened',
  'not_delivered_yet',
  'not_delivered',
  'cannot_receive',
  'opted_out',
  'skipped',
  'waiting',
] as const
export type Outcome = (typeof OUTCOMES)[number]

export function isOutcome(v: unknown): v is Outcome {
  return typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v)
}

export interface OutcomeInfo {
  label: string
  /** One plain sentence: who is in it. */
  means: string
  /** A follow-up broadcast may go to this group. */
  followUp: boolean
}

export const OUTCOME_INFO: Record<Outcome, OutcomeInfo> = {
  replied: { label: 'Replied', means: 'Answered within 3 days of getting it.', followUp: true },
  read_no_reply: { label: 'Read, no reply', means: 'Opened it but did not answer.', followUp: true },
  not_opened: {
    label: 'Delivered, not opened',
    means: 'It reached their phone but was not opened — or they hide read receipts.',
    followUp: true,
  },
  not_delivered_yet: {
    label: 'Sent, not delivered yet',
    means: 'Sent, but their phone has not received it (switched off or offline).',
    followUp: true,
  },
  not_delivered: {
    label: 'Not delivered — can try again',
    means: 'WhatsApp did not deliver it this time (daily limit, busy, or a template problem).',
    followUp: true,
  },
  cannot_receive: { label: 'Can’t receive', means: 'Not on WhatsApp, or not a valid number.', followUp: false },
  opted_out: { label: 'Opted out', means: 'Asked not to get these messages.', followUp: false },
  skipped: {
    label: 'Left out',
    means: 'Not sent: they replied in the meantime, opted out or were blocked after it was set up.',
    followUp: false,
  },
  waiting: { label: 'Waiting to send', means: 'Not sent yet.', followUp: false },
}

const NOT_A_NUMBER = /^(No phone number on contact|Invalid phone number format)/

export interface RecipientLite {
  status: string
  error_message?: string | null
}

export function outcomeOf(r: RecipientLite): Outcome {
  switch (r.status) {
    case 'replied':
      return 'replied'
    case 'read':
      return 'read_no_reply'
    case 'delivered':
      return 'not_opened'
    case 'sent':
      return 'not_delivered_yet'
    case 'skipped':
      return 'skipped'
    case 'failed': {
      const text = r.error_message ?? ''
      if (NOT_A_NUMBER.test(text)) return 'cannot_receive'
      const { category } = classifyMetaError(text)
      if (category === 'recipient_opted_out') return 'opted_out'
      if (category === 'recipient_unreachable') return 'cannot_receive'
      return 'not_delivered'
    }
    default:
      return 'waiting'
  }
}

export function countOutcomes(rows: readonly RecipientLite[]): Record<Outcome, number> {
  const out = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>
  for (const r of rows) out[outcomeOf(r)]++
  return out
}
