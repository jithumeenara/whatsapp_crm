/**
 * Change against the comparison period, as a number and a short text.
 * Pure and client-safe. Written locally because reports/headline.ts `change`
 * rounds to whole numbers only and has no small-number flag.
 */
export interface Change {
  /** Percent change, or null when there is nothing to compare with. */
  pct: number | null
  direction: 'up' | 'down' | 'flat' | null
  /** "+5.4%", "-20%", "No change", or "" when pct is null. */
  text: string
  /** Either figure is below the threshold: callers should fade the percentage. */
  small: boolean
}

export function formatChange(
  curr: number | null | undefined,
  prev: number | null | undefined,
  opts: { smallBelow?: number } = {},
): Change {
  const threshold = opts.smallBelow ?? 20
  if (curr == null || prev == null || !Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) {
    return { pct: null, direction: null, text: '', small: false }
  }
  const raw = ((curr - prev) / Math.abs(prev)) * 100
  const abs = Math.abs(raw)
  const rounded = abs < 10 ? Math.round(abs * 10) / 10 : Math.round(abs)
  const small = Math.abs(curr) < threshold || Math.abs(prev) < threshold
  if (rounded === 0) return { pct: 0, direction: 'flat', text: 'No change', small }
  const sign = raw < 0 ? -1 : 1
  return {
    pct: sign * rounded,
    direction: sign > 0 ? 'up' : 'down',
    text: `${sign > 0 ? '+' : '-'}${rounded}%`,
    small,
  }
}
