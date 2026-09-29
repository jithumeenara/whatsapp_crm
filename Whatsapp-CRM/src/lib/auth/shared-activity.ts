/**
 * The last moment a person touched this app in ANY of its tabs.
 *
 * ── Why the idle clock has to be shared ─────────────────────────────
 *
 * The idle timeout used to keep its clock per tab. Somebody with the
 * Inbox open in one tab and a template half-written in another was
 * signed out while typing: the untouched Inbox tab reached ten minutes,
 * called signOut(), and the cookie it removed was the one every tab
 * shares. The work in the busy tab was lost to a tab nobody was using.
 *
 * So each tab still keeps its own clock, and also writes it here, and
 * a tab only calls time on the session when neither has moved.
 *
 * This is only the browser's opinion. The session itself is ended by
 * src/proxy.ts, against a timestamp inside the signed JWT that only a
 * heartbeat from a tab with real activity can move — so nothing written
 * here, by this code or by anything else, can keep a session alive on
 * the server. It can only stop a tab from ending one early.
 */

const KEY = 'crm.last-activity'

/** How far ahead of this machine's clock a stored time may be and still
 *  be believed. Every tab reads the same clock, so anything further
 *  ahead was not written by one of them. */
const FUTURE_TOLERANCE_MS = 5_000

export function readSharedActivity(now: number = Date.now()): number {
  try {
    const at = Number(window.localStorage.getItem(KEY))
    return Number.isFinite(at) && at > 0 && at <= now + FUTURE_TOLERANCE_MS ? at : 0
  } catch {
    // Storage blocked (private window, a browser setting): each tab
    // falls back to its own clock, which is how it worked before.
    return 0
  }
}

export function writeSharedActivity(at: number): void {
  try {
    window.localStorage.setItem(KEY, String(at))
  } catch {
    // See readSharedActivity.
  }
}
