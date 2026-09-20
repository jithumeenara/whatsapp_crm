/**
 * How a closed lead ended.
 *
 * ── Why this is derived and not a status ────────────────────────────
 *
 * The close dialog has always asked Won or Lost, and has always
 * recorded the answer — `converted_at` for a win, `lost_reason` for a
 * loss. Only the chip never said which, so a list of closed leads read
 * as one undifferentiated pile and the single most useful fact about
 * each of them was invisible.
 *
 * The fix is to show what is already there, not to add `won` and `lost`
 * as statuses. Splitting the status would mean migrating every existing
 * row, teaching the Closed tab to match two values instead of one, and
 * revisiting every place that asks `status === 'closed'` — the funnel,
 * the SLA marking, the lead list's own filter. All of that to store a
 * second time something the row already knows.
 *
 * Derived also means it works backwards: every lead closed before today
 * shows its real outcome immediately, because the answer was captured
 * at the time.
 *
 * ── Why "closed" survives as an answer ──────────────────────────────
 *
 * A lead closed in bulk from the list records neither marker, and so
 * did anything closed before the dialog existed. Those are genuinely
 * closed-without-an-outcome, and saying "Closed" is the truth. Guessing
 * Lost for them would invent a defeat nobody reported and quietly
 * ruin every conversion figure that counts them.
 */

export type LeadOutcome = 'won' | 'lost' | 'closed'

export interface ClosableLead {
  status: string
  converted_at?: string | Date | null
  lost_reason?: string | null
}

/**
 * What to call a closed lead, or null when it is not closed at all.
 *
 * Returning null rather than 'closed' for an open lead keeps the two
 * questions apart: callers ask "is this closed" by checking the status
 * and "how did it end" by calling this.
 */
export function outcomeOf(lead: ClosableLead): LeadOutcome | null {
  if (lead.status !== 'closed') return null
  // Won beats lost when both are somehow set. A recorded conversion is
  // a stronger claim than a reason typed into a box, and the pair only
  // occurs through an edit that changed its mind.
  if (lead.converted_at) return 'won'
  if (lead.lost_reason?.trim()) return 'lost'
  return 'closed'
}

export const OUTCOME_LABEL: Record<LeadOutcome, string> = {
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}

/** Chip colours. Emerald and rose carry the meaning on their own, which
 *  is why the neutral case stays slate rather than borrowing either. */
export const OUTCOME_CHIP: Record<LeadOutcome, string> = {
  won: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  lost: 'bg-rose-50 text-rose-700 border-rose-100',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
}

/** The same, in the solid style the detail page uses. */
export const OUTCOME_COLOR: Record<LeadOutcome, string> = {
  won: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-rose-100 text-rose-700',
  closed: 'bg-slate-100 text-slate-600',
}
