/**
 * What one agent actually did, from what the app already records.
 *
 * ── Where the numbers come from, and why not from where you'd think ──
 *
 * There is no `type: 'call'` activity in this codebase. A call is
 * recorded as a status change on the lead — `type: 'stage_change'`,
 * with the outcome in `metadata.new_status` — because that is what the
 * agent actually does on the screen: they ring somebody and then say
 * how it went. Counting rows of type 'call' would return zero for
 * everybody, forever, and look like a quiet week.
 *
 * So an attempt is a stage change, and whether it connected is read
 * from the status it moved to. `call_not_connected` is the one status
 * that means nobody answered; every other destination — visited,
 * appointment fixed, follow-up, closed — is somebody who did.
 *
 * ── Why these five numbers ──────────────────────────────────────────
 *
 * Picked, attempted, reached, won, lost. They answer, in order: did
 * they take work, did they act on it, did they get through, and did it
 * come to anything. A dashboard of activity alone rewards the agent who
 * rings fifty people badly; one of outcomes alone punishes the agent
 * handed the worst leads. Both halves, side by side, is the only
 * honest version.
 */

/** The statuses a lead moves to. Only one of them means "nobody
 *  answered"; the rest all mean the conversation happened. */
export const NOT_CONNECTED_STATUS = 'call_not_connected'

export interface StageChange {
  /** From LeadActivity.metadata.new_status. */
  newStatus: string | null
  leadId: string | null
}

export interface Performance {
  /** Leads this person took off the pool in the window. */
  picked: number
  /** Times they rang somebody and recorded how it went. */
  attempted: number
  /** Of those, the ones where somebody answered. */
  reached: number
  /** Of those, the ones where nobody did. */
  missed: number
  /** Reached ÷ attempted, as a whole percentage. Null when they have
   *  not rung anybody — 0% would read as "never gets through", which is
   *  a different and unfair claim. */
  reachedPct: number | null
  /** Closed and converted. */
  won: number
  /** Closed and not. */
  lost: number
  /** Won ÷ (won + lost). Null when nothing has closed yet, for the same
   *  reason as above. */
  conversionPct: number | null
  /** Distinct leads they rang, which is not the same as attempts — one
   *  lead rung four times is four attempts and one person. */
  leadsWorked: number
}

/**
 * Turn the raw rows into the five numbers.
 *
 * Pure, so the arithmetic can be tested without a database — the part
 * that is easy to get subtly wrong is the percentages, not the queries.
 */
export function summarise(args: {
  picked: number
  stageChanges: StageChange[]
  won: number
  lost: number
}): Performance {
  const { picked, stageChanges, won, lost } = args

  const attempted = stageChanges.length
  const missed = stageChanges.filter((c) => c.newStatus === NOT_CONNECTED_STATUS).length
  const reached = attempted - missed

  const leadsWorked = new Set(
    stageChanges.map((c) => c.leadId).filter((id): id is string => !!id),
  ).size

  const closed = won + lost

  return {
    picked,
    attempted,
    reached,
    missed,
    // Rounded, not floored: 2 of 3 is 67%, and showing 66% to somebody
    // who can do the division themselves costs more trust than the
    // percentage point is worth.
    reachedPct: attempted > 0 ? Math.round((reached / attempted) * 100) : null,
    won,
    lost,
    conversionPct: closed > 0 ? Math.round((won / closed) * 100) : null,
    leadsWorked,
  }
}
