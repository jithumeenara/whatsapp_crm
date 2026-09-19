/**
 * Saying out loud when a lead has been sitting.
 *
 * A lead nobody has touched for four days looks exactly like one claimed
 * an hour ago: same row, same colour, same place in the list once it is
 * sorted by anything but age. The ones going cold are the ones worth
 * seeing first, and they were the hardest to find.
 *
 * ── What "touched" means ────────────────────────────────────────────
 *
 * `updated_at`. Not a separate column, deliberately: every real action
 * on a lead — a status change, a note, a claim, a score — writes the
 * row, so the timestamp already answers "when did somebody last do
 * something about this". A dedicated last_touched_at would be a second
 * source of truth that some code path would eventually forget to set,
 * and a stale lead that looks fresh is worse than no marking at all.
 *
 * ── Why two thresholds ──────────────────────────────────────────────
 *
 * "Slipping" and "neglected" want different reactions — a nudge and an
 * escalation — and one number cannot say both. Hours rather than days
 * because an inside-sales team measures this in hours and a training
 * institute in days; hours express both without a second unit.
 *
 * ── What it deliberately does not do ────────────────────────────────
 *
 * It does not reassign, escalate, notify or close anything. It is a
 * colour on a row. Automatic action on a timer is how a lead somebody
 * was deliberately holding gets taken off them at two in the morning;
 * the person looking at the list is better placed to decide.
 */

export type SlaState = 'ok' | 'warn' | 'breach'

export interface SlaThresholds {
  /** Hours untouched before a lead is "slipping". 0 disables. */
  warnHours: number
  /** Hours untouched before it is "neglected". 0 disables. */
  breachHours: number
}

export const DEFAULT_SLA: SlaThresholds = { warnHours: 24, breachHours: 72 }

const HOUR_MS = 60 * 60 * 1000

/** Hours since a lead was last written to. Negative clock skew reads as
 *  zero rather than as a lead from the future. */
export function hoursUntouched(updatedAt: string | Date, now: Date = new Date()): number {
  const then = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (Number.isNaN(then.getTime())) return 0
  return Math.max(0, (now.getTime() - then.getTime()) / HOUR_MS)
}

/**
 * Where this lead stands.
 *
 * A closed lead is never late: it is finished, and marking finished work
 * as overdue is how a list of warnings becomes something people stop
 * reading.
 */
export function slaStateFor(
  lead: { status?: string | null; updated_at: string | Date },
  thresholds: SlaThresholds = DEFAULT_SLA,
  now: Date = new Date(),
): SlaState {
  if (lead.status === 'closed') return 'ok'

  const hours = hoursUntouched(lead.updated_at, now)
  if (thresholds.breachHours > 0 && hours >= thresholds.breachHours) return 'breach'
  if (thresholds.warnHours > 0 && hours >= thresholds.warnHours) return 'warn'
  return 'ok'
}

/**
 * "4d untouched", the way somebody would say it.
 *
 * Rounded down and to one unit: "3 days" is what matters, not "3 days
 * 7 hours". Under an hour is "just now" rather than "0h", which reads
 * like a missing value.
 */
export function describeUntouched(updatedAt: string | Date, now: Date = new Date()): string {
  const hours = hoursUntouched(updatedAt, now)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.floor(hours)}h untouched`
  const days = Math.floor(hours / 24)
  return `${days}d untouched`
}

/** Tailwind classes per state, in one place so the table, the tiles and
 *  the detail page cannot drift into three different reds. */
export const SLA_STYLES: Record<SlaState, { dot: string; chip: string; bar: string }> = {
  ok: { dot: '', chip: '', bar: '' },
  warn: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700',
    bar: 'border-l-2 border-l-amber-400',
  },
  breach: {
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700',
    bar: 'border-l-2 border-l-rose-500',
  },
}
