/**
 * How long a session survives without the person doing anything.
 *
 * ── Why these two numbers live alone in their own file ──────────────
 *
 * They were copied. The idle timeout was written in src/proxy.ts, the
 * heartbeat throttle in src/hooks/use-idle-timeout.ts, and then presence
 * invented a third window (30 minutes) and agent routing a fourth (15),
 * neither derived from either. So the app enforced a 10-minute logout
 * while telling a supervisor the same agent was still reachable twenty
 * minutes later, and handed that agent conversations they could not see
 * because their session had already been destroyed.
 *
 * None of those numbers was wrong in isolation. The problem was that
 * four files each held their own opinion about the same fact, and three
 * of them could never be corrected by fixing the fourth.
 *
 * Everything that needs to know "is this person still signed in" now
 * reads it from here. This file deliberately imports nothing: it is
 * loaded by the edge proxy, by browser code and by server routes alike,
 * and anything with a dependency could not be.
 */

/**
 * Zero interaction for this long and the session is destroyed.
 *
 * Enforced in src/proxy.ts on every single request, against a claim
 * inside the signed JWT — so a browser that stopped running JavaScript,
 * or a cookie replayed from somewhere else, cannot extend it.
 */
export const IDLE_TIMEOUT_MS = 10 * 60_000

/**
 * The most often a live browser tells the server it is still there.
 *
 * Real activity refreshes the local clock instantly; the network call
 * is throttled to this, because a moving mouse must not become a
 * request per frame. It is the reason presence can never be perfectly
 * fresh — at any moment the newest timestamp may be this old.
 */
export const HEARTBEAT_THROTTLE_MS = 60_000

/**
 * Past this, the person is definitely signed out.
 *
 * The timeout plus the throttle, and the sum is what makes it *proof*
 * rather than a guess. A heartbeat can be up to one throttle late, so a
 * timestamp of exactly IDLE_TIMEOUT_MS ago might belong to somebody
 * whose real last action was a minute more recent and who therefore has
 * a few seconds of session left. Add the throttle and there is no such
 * case: the proxy has already refused them.
 *
 * This is the one window used everywhere — the dot in Settings, the
 * agent picker in flows, and whether a returning customer's thread is
 * taken back off its owner. They agree because they are the same
 * number.
 */
export const SIGNED_OUT_AFTER_MS = IDLE_TIMEOUT_MS + HEARTBEAT_THROTTLE_MS
