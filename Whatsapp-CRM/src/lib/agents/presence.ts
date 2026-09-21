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
 * ── Why the windows are derived and not chosen ──────────────────────
 *
 * This file used to pick its own numbers: online under three minutes,
 * away under thirty, offline after that. Thirty was a guess, and it was
 * wrong in a way that mattered. The app destroys a session after ten
 * minutes of inactivity (src/proxy.ts) — past that the person is not
 * "away", they are signed out, and the next thing they see is the login
 * page. For twenty minutes the dot said amber about somebody the server
 * had already ejected, so a supervisor read "they'll be back in a
 * moment" about somebody who would have to log in again, and a flow
 * handed a live customer to an agent with no session to receive them.
 *
 * Offline is therefore not a judgement any more. It is the point past
 * which the session provably cannot exist — see SIGNED_OUT_AFTER_MS in
 * src/lib/auth/session-timing.ts, which is the timeout plus the
 * heartbeat throttle, so there is no borderline case left over.
 *
 * ── Why leaving is recorded as well as inferred ─────────────────────
 *
 * Waiting out the timeout answers "have they gone?" eventually. It
 * cannot answer it *now*, and two very ordinary things deserve an
 * immediate answer: pressing Log out, and closing the window. Both were
 * invisible. Someone who signed out and went home stayed green for
 * three minutes and stayed in the routing pool for fifteen.
 *
 * So `went_offline_at` is stamped when a person leaves — by the sign-out
 * event in src/auth.ts, and by the browser on its way out in
 * src/hooks/use-idle-timeout.ts. It is not a status they set; it is a
 * departure they performed. And it loses to any later heartbeat, which
 * is what makes coming back free: the next sign of life is newer, so it
 * wins, and nothing has to be cleared.
 */

import { HEARTBEAT_THROTTLE_MS, SIGNED_OUT_AFTER_MS } from '@/lib/auth/session-timing'

/** Three missed heartbeats. Long enough that a slow network or a tab
 *  the browser throttled in the background does not read as somebody
 *  leaving, short enough that the dot means something. */
export const ONLINE_WITHIN_MS = 3 * HEARTBEAT_THROTTLE_MS

/** Past this the session no longer exists, so neither does the person.
 *  Not a number chosen here — the timeout decides it. */
export const AWAY_WITHIN_MS = SIGNED_OUT_AFTER_MS

export type Presence = 'online' | 'away' | 'offline'

/**
 * A person's presence row.
 *
 * `presenceOf` accepts either this or a bare timestamp. The bare form is
 * how most callers already had it and is still correct — it simply
 * cannot express "they left just now", so anywhere that has the whole
 * row should pass the whole row.
 */
export interface PresenceInput {
  last_seen_at?: Date | string | null
  /** When they pressed Log out, or closed the last window. */
  went_offline_at?: Date | string | null
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  const t = d.getTime()
  return Number.isNaN(t) ? null : t
}

function asRow(
  who: PresenceInput | Date | string | null | undefined,
): PresenceInput {
  if (who && typeof who === 'object' && !(who instanceof Date)) return who
  return { last_seen_at: who as Date | string | null | undefined }
}

export function presenceOf(
  who: PresenceInput | Date | string | null | undefined,
  now: Date = new Date(),
): Presence {
  const row = asRow(who)

  const seen = toTime(row.last_seen_at)
  if (seen === null) return 'offline'

  // They told us they were going, and nothing has happened since. This
  // beats the clock in both directions: it makes a fresh timestamp read
  // offline when the person has left, and a later heartbeat makes them
  // present again without anybody having to undo anything.
  const left = toTime(row.went_offline_at)
  if (left !== null && left >= seen) return 'offline'

  // A timestamp from the future is a clock disagreement, not a
  // prediction. Treated as "just now" rather than as nonsense, because
  // the alternative is marking a working agent offline.
  const age = now.getTime() - seen
  if (age < ONLINE_WITHIN_MS) return 'online'
  if (age < AWAY_WITHIN_MS) return 'away'
  return 'offline'
}

/**
 * Is this person available to be given work right now?
 *
 * Only 'online'. 'away' is deliberately excluded: the whole point of
 * routing to a live agent is that somebody answers, and "they were here
 * eight minutes ago" is not that.
 */
export function isAvailable(
  who: PresenceInput | Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  return presenceOf(who, now) === 'online'
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
  who: PresenceInput | Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  return presenceOf(who, now) === 'offline'
}

export const PRESENCE_LABELS: Record<Presence, { label: string; hint: string }> = {
  online: { label: 'Online', hint: 'Active in the last few minutes' },
  away: { label: 'Away', hint: 'Signed in, but not at the keyboard' },
  offline: { label: 'Offline', hint: 'Signed out — not reachable in the app' },
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
  who: PresenceInput | Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const seen = toTime(asRow(who).last_seen_at)
  if (seen === null) return 'never signed in'
  const mins = Math.floor((now.getTime() - seen) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
