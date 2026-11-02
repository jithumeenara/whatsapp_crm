/**
 * Two tiny limiters for audit events that could otherwise flood the log:
 *
 * countThrottled()  a burst becomes ONE event per key per window, carrying
 *                   the count and first/last time (bad webhook signatures,
 *                   refused sockets). The event is written when the window
 *                   closes, or on flushThrottled().
 * onceWithin()      true the first time a key is seen in a window, false
 *                   after (a file viewed by the same person the same day).
 *
 * In memory, per process; a restart loses at most one window. No database
 * and no 'next/server' import, so server.ts may use it.
 */

type Flush = (count: number, firstAt: Date, lastAt: Date) => void | Promise<unknown>

interface Bucket {
  count: number
  firstAt: Date
  lastAt: Date
  timer: ReturnType<typeof setTimeout>
  flush: Flush
}

/** Enough for every provider/account pair many times over; past it the
 *  oldest buckets are written early rather than memory growing. */
const MAX_BUCKETS = 2000
const MAX_SEEN = 20000

const buckets = new Map<string, Bucket>()
const seen = new Map<string, number>()

function flushKey(key: string): Promise<void> {
  const b = buckets.get(key)
  if (!b) return Promise.resolve()
  buckets.delete(key)
  clearTimeout(b.timer)
  return Promise.resolve()
    .then(() => b.flush(b.count, b.firstAt, b.lastAt))
    .then(() => undefined)
    .catch((err) => console.error('[audit] throttled flush failed:', err instanceof Error ? err.message : err))
}

/** Counts one occurrence; at most one flush per key per window. */
export function countThrottled(key: string, windowMs: number, flush: Flush, now: Date = new Date()): void {
  const b = buckets.get(key)
  if (b) {
    b.count += 1
    b.lastAt = now
    return
  }
  if (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value
    if (oldest !== undefined) void flushKey(oldest)
  }
  const timer = setTimeout(() => void flushKey(key), windowMs)
  ;(timer as { unref?: () => void }).unref?.()
  buckets.set(key, { count: 1, firstAt: now, lastAt: now, timer, flush })
}

/** Writes every open bucket now (shutdown, tests). */
export async function flushThrottled(): Promise<void> {
  await Promise.all([...buckets.keys()].map(flushKey))
}

/** True once per key per window. */
export function onceWithin(key: string, windowMs: number, now: number = Date.now()): boolean {
  const last = seen.get(key)
  if (last !== undefined && now - last < windowMs) return false
  if (seen.size >= MAX_SEEN) {
    for (const [k, t] of seen) if (now - t >= windowMs) seen.delete(k)
    if (seen.size >= MAX_SEEN) seen.clear()
  }
  seen.delete(key)
  seen.set(key, now)
  return true
}

/** For tests only. */
export function resetThrottleForTests(): void {
  for (const b of buckets.values()) clearTimeout(b.timer)
  buckets.clear()
  seen.clear()
}

process.once('beforeExit', () => void flushThrottled())
