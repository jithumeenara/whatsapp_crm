/**
 * Who is actually at their desk.
 *
 * ── Why this is measured, not declared ──────────────────────────────
 *
 * The obvious design is a status people set: Online, Away, Busy. Every
 * help desk ships one, and Zendesk's own documentation quietly admits
 * its weakness — "agents must set themselves to Away or Offline
 * whenever they aren't available". They must, and they do not. Somebody
 * goes to lunch marked Online and the queue keeps handing them work;
 * somebody leaves for the night marked Online and a customer waits until
 * morning. A status that is only true when a person remembers to update
 * it is a status that is usually wrong, and the times it is wrong are
 * exactly the times it matters.
 *
 * So presence here is not declared. It is the last moment the person
 * demonstrably used the app, and that signal already existed: the idle
 * timeout posts a heartbeat on real activity, throttled to once a
 * minute, in src/hooks/use-idle-timeout.ts. Nobody has to remember
 * anything, and nobody can be wrong about it on purpose.
 *
 * ── Why 'away' exists between online and offline ────────────────────
 *
 * A single boolean would have to choose between two mistakes: a short
 * window calls somebody offline while they are reading a long message,
 * and a long one calls somebody online twenty minutes after they left.
 * The middle state says what is true — they were here recently and may
 * be again — and lets each caller decide what to do about it. Handing
 * new work to an 'away' agent is wrong; taking work off them is also
 * wrong.
 */

/** Longer than the heartbeat's own 60s throttle, so one missed beat —
 *  a slow network, a browser tab throttled in the background — does not
 *  read as somebody leaving. */
export const ONLINE_WITHIN_MS = 3 * 60_000

/** Past this, assume they have gone. Chosen to outlast a coffee, a
 *  phone call and a short meeting, because being wrongly marked offline
 *  costs an agent their own conversations. */
export const AWAY_WITHIN_MS = 30 * 60_000

export type Presence = 'online' | 'away' | 'offline'

export function presenceOf(
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date(),
): Presence {
  if (!lastSeenAt) return 'offline'
  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt)
  const age = now.getTime() - seen.getTime()
  // A timestamp from the future is a clock disagreement, not a
  // prediction. Treated as "just now" rather than as nonsense, because
  // the alternative is marking a working agent offline.
  if (Number.isNaN(age)) return 'offline'
  if (age < ONLINE_WITHIN_MS) return 'online'
  if (age < AWAY_WITHIN_MS) return 'away'
  return 'offline'
}

/**
 * Is this person available to be given work right now?
 *
 * Only 'online'. 'away' is deliberately excluded: the whole point of
 * routing to a live agent is that somebody answers, and "they were here
 * twenty minutes ago" is not that.
 */
export function isAvailable(
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  return presenceOf(lastSeenAt, now) === 'online'
}

/**
 * Should a thread this person owns be handed back to the team?
 *
 * The question a reopened conversation asks, and the one the industry
 * answers with agent status: Zendesk's omnichannel routing "doesn't
 * assign reopened tickets to agents with Online status" and reassigns
 * based on the current assignee's status, rather than reassigning
 * every reopened ticket.
 *
 * Only 'offline' releases. An agent who is here keeps their customer —
 * continuity is worth something, and the customer who comes back often
 * wants the person who already knows them. An agent who is merely
 * 'away' keeps them too, because they are coming back. An agent who has
 * gone loses them, because otherwise the thread is owned by nobody
 * present, the assistant stays out of it on their behalf, and the
 * customer is answered by no one at all.
 */
export function shouldReleaseOnReturn(
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  return presenceOf(lastSeenAt, now) === 'offline'
}

export const PRESENCE_LABELS: Record<Presence, { label: string; hint: string }> = {
  online: { label: 'Online', hint: 'Active in the last few minutes' },
  away: { label: 'Away', hint: 'Was here recently' },
  offline: { label: 'Offline', hint: 'Not using the app' },
}

/** Tailwind classes for the status dot. Kept beside the rule so the
 *  colour and the meaning cannot drift apart. */
export const PRESENCE_DOT: Record<Presence, string> = {
  online: 'bg-emerald-500',
  away: 'bg-amber-400',
  offline: 'bg-slate-300',
}

/** "2 minutes ago", for a tooltip. Short, because it sits in a row. */
export function describeLastSeen(
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  if (!lastSeenAt) return 'never signed in'
  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt)
  const mins = Math.floor((now.getTime() - seen.getTime()) / 60_000)
  if (Number.isNaN(mins)) return 'unknown'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
