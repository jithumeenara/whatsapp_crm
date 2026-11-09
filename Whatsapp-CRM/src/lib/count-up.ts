/**
 * The arithmetic behind a number that counts up when a screen first loads.
 * Pure, so it is tested without a browser.
 *
 * The app's CSS stops animations for people who ask for less motion
 * (globals.css), but that cannot reach motion done in JavaScript: a count-up
 * has to ask for itself, which is prefersReducedMotion below.
 */

/** Fast at the start and settling at the end: the number looks like it arrives. */
export function easeOutCubic(t: number): number {
  if (!Number.isFinite(t) || t >= 1) return 1
  if (t <= 0) return 0
  return 1 - Math.pow(1 - t, 3)
}

/** The value `progress` (0 to 1) of the way from `from` to `to`; exactly `to` at the end. */
export function valueAt(from: number, to: number, progress: number): number {
  const p = easeOutCubic(progress)
  return p >= 1 ? to : from + (to - from) * p
}

/** True when the person asked their device for less motion. False when it cannot be asked. */
export function prefersReducedMotion(win: { matchMedia?: (query: string) => { matches: boolean } } | undefined): boolean {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}
