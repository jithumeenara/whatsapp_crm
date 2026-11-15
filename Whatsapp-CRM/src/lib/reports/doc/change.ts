/**
 * How a figure changed against the period before — ONE rule for the
 * screen, the PDF, the slides and the workbook, so they never disagree.
 *
 * - A count with fewer than 10 before is too few to judge: "2 → 32" is
 *   not "+1,500%". (So is anything the builder already marked small.)
 * - A percentage moves in points, never in percent of a percent.
 * - More than four times the base reads "11.6× before", not "+1062%".
 * - From zero (money, minutes) it says how much it moved.
 * - Otherwise a percent, one decimal under 10%.
 */

import type { Compared, Fmt } from './types'

/** Below this many before, a count's change is not judged. */
export const SMALL_BASE = 10
/** Above this ratio (now ÷ before) the change reads "N× before". */
export const TIMES_FROM = 4

export type ChangeKind = 'none' | 'small' | 'same' | 'pct' | 'pts' | 'abs' | 'times'

export interface Change {
  kind: ChangeKind
  /** now − before (pts / abs), ratio − 1 (pct), now ÷ before (times). */
  value: number | null
  tone: 'good' | 'bad' | null
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)

export function judgeChange(c: Compared & { fmt: Fmt }): Change {
  if (!finite(c.now) || !finite(c.before)) return { kind: 'none', value: null, tone: null }
  const diff = c.now - c.before
  if (c.small || (c.fmt.kind === 'count' && Math.abs(c.before) < SMALL_BASE)) return { kind: 'small', value: null, tone: null }
  // Two waits both under a minute: seconds apart, not a trend.
  if (c.fmt.kind === 'minutes' && Math.abs(c.before) < 1 && Math.abs(c.now) < 1) return { kind: 'small', value: null, tone: null }
  if (diff === 0) return { kind: 'same', value: 0, tone: null }
  const tone = (diff > 0) === c.higherIsBetter ? 'good' : 'bad'
  if (c.fmt.kind === 'percent') return { kind: 'pts', value: Math.round(diff * 10) / 10, tone }
  if (c.before === 0) return { kind: 'abs', value: diff, tone }
  const ratio = c.now / c.before
  if (c.before > 0 && ratio > TIMES_FROM) return { kind: 'times', value: Math.round(ratio * 10) / 10, tone }
  return { kind: 'pct', value: diff / Math.abs(c.before), tone }
}

export interface ChangeWords {
  tooFew: string
  times: (n: string) => string
}

const EN: ChangeWords = { tooFew: 'Too few to judge', times: (n) => `${n}× before` }

/** The change as text. `abs` formats an amount (money, minutes) the caller's way. */
export function changeLabel(ch: Change, abs: (v: number) => string, words: ChangeWords = EN): string | null {
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '±')
  switch (ch.kind) {
    case 'none': return null
    case 'small': return words.tooFew
    case 'same': return '±0%'
    case 'pts': return `${sign(ch.value!)}${Math.abs(ch.value!).toFixed(1).replace(/\.0$/, '')} pts`
    case 'abs': return `${sign(ch.value!)}${abs(Math.abs(ch.value!))}`
    case 'times': return words.times(ch.value!.toFixed(1).replace(/\.0$/, ''))
    default: {
      const p = Math.abs(ch.value!) * 100
      return `${sign(ch.value!)}${p < 10 ? Number(p.toFixed(1)) : Math.round(p)}%`
    }
  }
}
