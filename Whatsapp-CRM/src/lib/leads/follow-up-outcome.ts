/**
 * What happened to a scheduled follow-up, in the words people use:
 *
 *  - done          — "Done": the call happened.
 *  - rescheduled   — "Reschedule": same call, a new time.
 *  - not_reached   — "Couldn't reach": tried, nobody answered or the
 *                    customer could not talk. Optionally a time to try
 *                    again, which becomes a new follow-up.
 *
 * Stored with the statuses the Follow-ups page already knows: done
 * stays done, not_reached is 'skipped' (shown there as Skipped), and a
 * reschedule leaves it pending with a new due time.
 */

const PAST_GRACE_MS = 10 * 60 * 1000
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000
const MAX_NOTE = 1000

export type FollowUpOutcome = 'done' | 'rescheduled' | 'not_reached'

export type OutcomeInput =
  | { ok: true; outcome: FollowUpOutcome; note: string | null; nextAt: Date | null }
  | { ok: false; error: string }

function parseFuture(raw: unknown, now: Date): Date | 'bad' | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') return 'bad'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return 'bad'
  if (d.getTime() < now.getTime() - PAST_GRACE_MS) return 'bad'
  if (d.getTime() > now.getTime() + MAX_AHEAD_MS) return 'bad'
  return d
}

export function parseOutcomeInput(body: unknown, now = new Date()): OutcomeInput {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request' }
  const b = body as Record<string, unknown>
  const outcome = b.outcome
  if (outcome !== 'done' && outcome !== 'rescheduled' && outcome !== 'not_reached') {
    return { ok: false, error: 'Choose Done, Reschedule or Couldn’t reach' }
  }
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, MAX_NOTE) || null : null

  const next = parseFuture(b.next_at, now)
  if (next === 'bad') return { ok: false, error: 'Choose a time from now to a year ahead' }
  if (outcome === 'rescheduled' && !next) return { ok: false, error: 'Choose the new date and time' }
  if (outcome === 'done' && next) return { ok: false, error: 'A finished follow-up has no next time' }

  return { ok: true, outcome, note, nextAt: next }
}

/** The line written on the lead's timeline. */
export function outcomeTitle(outcome: FollowUpOutcome): string {
  return outcome === 'done'
    ? 'Follow-up done'
    : outcome === 'rescheduled'
      ? 'Follow-up rescheduled'
      : 'Couldn’t reach the customer'
}
