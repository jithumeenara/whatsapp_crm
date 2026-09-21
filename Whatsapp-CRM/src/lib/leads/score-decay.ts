/**
 * A lead marked Hot three weeks ago is not Hot.
 *
 * ── The thing this fixes ────────────────────────────────────────────
 *
 * Score is set once, by hand, and then never moves. Somebody marks an
 * enquiry Hot on the day it arrives — correctly — and it stays Hot
 * through the customer going quiet, through a month of nobody calling,
 * through the person buying from somebody else. The Hot filter fills up
 * with leads that were hot, and stops being worth opening.
 *
 * Interest has a half-life. A list that does not model that is a list
 * that gets abandoned, and the fix is arithmetic rather than
 * intelligence: no model, no API call, nothing to switch on.
 *
 * ── Why it measures the customer, not us ────────────────────────────
 *
 * src/lib/leads/sla.ts already answers a neighbouring question — has
 * anybody here touched this — from `updated_at`. That is our activity,
 * and it is the wrong clock for this one: an agent can update a lead
 * ten times while the customer says nothing at all, and the lead is
 * cooling the whole time.
 *
 * So this reads `last_customer_at`: the last time the person actually
 * said something. The two together are genuinely different facts. A
 * lead can be worked hard and still going cold, and it is worth being
 * able to see that.
 *
 * ── Why it derives rather than overwrites ───────────────────────────
 *
 * Nothing here writes. The stored score keeps saying what a person
 * decided, and the faded one is computed when it is shown — the same
 * choice as outcomeOf() for won and lost, for the same reason. An agent
 * who set Hot after a phone call knows something this file does not,
 * and a nightly job that quietly demoted their judgement would be a
 * feature they came to resent.
 *
 * Which also means it costs nothing to change these windows later, and
 * nothing to turn off: no column to rewrite, no history to repair.
 *
 * ── Why the ladder is the account's own ─────────────────────────────
 *
 * Hot/Warm/Cold is only the default. An account can rename the levels
 * or have four of them, so fading is "one step down whatever list this
 * business uses" rather than a hardcoded mapping — which would silently
 * do nothing for every account that had renamed anything.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How far a score falls, by how long the customer has been silent.
 *
 * The shape is the one the industry converged on for behavioural
 * scores: full weight for a fortnight, then steadily less, and nothing
 * left after about three months. Expressed as steps down the ladder
 * because these levels are words, not numbers.
 *
 * Fourteen days before anything moves is deliberate. Somebody waiting
 * on a salary, a result or a family decision is normal and is not
 * cooling; demoting them in the first week would make the fading itself
 * untrustworthy, and a feature people distrust gets switched off.
 */
export const DECAY_STEPS: Array<{ afterDays: number; steps: number }> = [
  { afterDays: 90, steps: 3 },
  { afterDays: 60, steps: 2 },
  { afterDays: 30, steps: 1 },
]

export interface DecayInput {
  /** What a person set, or the default. */
  score: string
  /** When the customer last said anything. Null means nobody knows —
   *  usually a lead created before this was recorded. */
  lastCustomerAt?: Date | string | null
  /** This account's levels, hottest first. */
  ladder: string[]
}

export interface DecayResult {
  /** What to show. Equal to `score` when nothing has faded. */
  effective: string
  /** What a person actually set, always. */
  set: string
  /** How many levels it has dropped. 0 means it has not. */
  dropped: number
  /** Whole days since the customer last said anything, or null. */
  quietDays: number | null
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days of silence. A timestamp from the future reads as zero
 *  rather than as a negative age — two clocks disagreeing must not make
 *  a lead hotter than it is. */
export function quietDays(
  lastCustomerAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const then = toDate(lastCustomerAt)
  if (!then) return null
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY_MS))
}

/**
 * What this lead's score really is today.
 *
 * Never fades a score that is already at the bottom of the ladder, and
 * never fades one the app cannot place on the ladder at all — an
 * account that renamed its levels after leads were scored would
 * otherwise have every old lead silently jump to the coldest setting.
 */
export function decayScore(input: DecayInput, now: Date = new Date()): DecayResult {
  const set = input.score
  const days = quietDays(input.lastCustomerAt, now)
  const base: DecayResult = { effective: set, set, dropped: 0, quietDays: days }

  // Nobody knows when they last spoke, so nothing can be said about
  // whether they have gone quiet. Silence about a fact is better than
  // inventing one.
  if (days === null) return base

  const ladder = input.ladder.filter((l) => l.trim())
  if (ladder.length < 2) return base

  const index = ladder.findIndex((l) => l.toLowerCase() === set.trim().toLowerCase())
  if (index === -1) return base

  const rule = DECAY_STEPS.find((r) => days >= r.afterDays)
  if (!rule) return base

  const target = Math.min(index + rule.steps, ladder.length - 1)
  return {
    effective: ladder[target],
    set,
    dropped: target - index,
    quietDays: days,
  }
}

/**
 * Why this lead is showing colder than somebody set it.
 *
 * Shown as a tooltip beside a faded score, because a score that changed
 * on its own with no explanation is the kind of thing people file a bug
 * about — and then distrust afterwards even once it is explained.
 */
export function describeDecay(result: DecayResult): string | null {
  if (result.dropped === 0 || result.quietDays === null) return null
  const weeks = Math.floor(result.quietDays / 7)
  const howLong =
    result.quietDays >= 60
      ? `${Math.floor(result.quietDays / 30)} months`
      : weeks >= 2
        ? `${weeks} weeks`
        : `${result.quietDays} days`
  return `Set to ${result.set}, but the customer has not written for ${howLong}.`
}
