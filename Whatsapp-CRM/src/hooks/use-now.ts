'use client'

import { useEffect, useState } from 'react'

/**
 * A clock that makes relative times keep being true.
 *
 * "Online", "2 min ago", "4:31 unclaimed" are all computed from the
 * current time, so a page that renders them once and never again starts
 * lying the moment it finishes loading. An agent who left ten minutes
 * ago stays green until somebody reloads — which is precisely the
 * failure a presence indicator exists to prevent.
 *
 * ── Why it starts undefined ─────────────────────────────────────────
 *
 * Reading the clock while rendering makes a component impure: the same
 * props would produce different output, which React is entitled to
 * treat as a bug. So this holds nothing until its first tick, and
 * returns `undefined` until then.
 *
 * That is not a gap. Every helper that takes a `now` defaults it to the
 * real current time, so passing `undefined` through is correct on the
 * first paint and correct on every tick after it — the impurity lives
 * in one plain function instead of in every component that renders a
 * timestamp.
 *
 * Pass the coarsest interval that still looks alive: a status dot is
 * fine at thirty seconds, a stopwatch needs one.
 */
export function useNow(everyMs = 30_000): Date | undefined {
  const [now, setNow] = useState<Date>()

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])

  return now
}
