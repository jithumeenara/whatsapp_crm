'use client'

/**
 * How many windows of this app the person still has open.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * Closing the window is the most common way an agent stops being
 * available — far more common than pressing Log out — and it is silent.
 * The browser can be told to send one last message on its way out, which
 * turns a ten-minute guess into an immediate fact.
 *
 * The trap is that agents keep two tabs open. Inbox in one, Leads in the
 * other. Closing either one fires that farewell, and without this the
 * app would announce that somebody had left while they sat looking at
 * the tab they kept. A false "offline" is worse than a late one: a late
 * one only delays the truth, a false one takes an agent out of the
 * routing pool while they are working.
 *
 * So each tab registers itself, and only the last one out says anything.
 *
 * ── Why a timestamp per tab rather than a counter ───────────────────
 *
 * A counter is one crashed tab away from being permanently wrong, and
 * nothing would ever correct it — the count would sit at 1 forever and
 * the farewell would never be sent again. Timestamps are self-healing:
 * every open tab refreshes its own every half minute, so an entry left
 * behind by a crash, a killed process or a phone that ran out of battery
 * ages out on its own within ninety seconds.
 *
 * This deliberately does not answer "is the person working" — that is
 * the heartbeat's job, and it is throttled by activity. This answers
 * "is a window open", which is a different question and has to keep
 * ticking while somebody reads.
 */

const KEY = 'crm.open-tabs'

/** Every open tab refreshes its own entry this often. Cheap: it is a
 *  local write, not a request. */
export const TAB_TOUCH_MS = 30_000

/** Three missed touches. An entry older than this belongs to a tab that
 *  is gone — crashed, killed, or on a device that lost power — and is
 *  ignored rather than blocking the farewell forever. */
const TAB_STALE_MS = 3 * TAB_TOUCH_MS

type Registry = Record<string, number>

/**
 * Storage can be absent (server render), blocked (a private window, or a
 * browser set to refuse site data) or full. None of those are worth an
 * error: they cost the multi-tab check, and the fallback is the old
 * behaviour, which was correct-but-early rather than broken.
 */
function read(): Registry | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const cutoff = Date.now() - TAB_STALE_MS
    const out: Registry = {}
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && at > cutoff) out[id] = at
    }
    return out
  } catch {
    return null
  }
}

function write(registry: Registry): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(registry))
  } catch {
    // Nothing to do and nothing worth saying. See read().
  }
}

/** A name for this tab. Not a user id and not stored anywhere but the
 *  registry — it exists for the length of one page. */
export function newTabId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** Say this tab is still open. Called on a timer, not on activity. */
export function touchTab(id: string): void {
  const registry = read()
  if (registry === null) return
  registry[id] = Date.now()
  write(registry)
}

/**
 * Say this tab is closing.
 *
 * Returns true when it was the last one, which is the caller's cue to
 * tell the server the person has gone. When storage is unavailable it
 * returns true as well: without the registry there is no way to know
 * about other tabs, and being early is the lesser mistake — the person
 * who still has a tab open is a heartbeat away from being back online,
 * while the person who closed their only window would otherwise be
 * shown as present for another eleven minutes.
 */
export function releaseTab(id: string): boolean {
  const registry = read()
  if (registry === null) return true
  delete registry[id]
  write(registry)
  return Object.keys(registry).length === 0
}
