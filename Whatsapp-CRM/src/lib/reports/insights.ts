/**
 * Automatic insights — plain sentences about a report, written by rules,
 * not by AI.
 *
 * Every number in them is copied from the result, so they are exactly as
 * true as the report, cost nothing, and send nothing anywhere. They are
 * what a report says on its own; an AI summary, where an account turns
 * one on, is an extra on top and never a replacement.
 *
 * A rule speaks only when it has something worth saying: a change on a
 * base too small to mean anything, or a "top group" that is the only
 * group, stays quiet.
 */

import type { ReportResult } from './engine'
import { shortDay } from './period'

const MIN_BASE = 5

export function formatValue(value: number, unit: ReportResult['unit']): string {
  if (unit === 'INR') return `₹${Math.round(value).toLocaleString('en-IN')}`
  if (unit === 'min') return `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })} min`
  return Number.isInteger(value)
    ? value.toLocaleString('en-IN')
    : value.toLocaleString('en-IN', { maximumFractionDigits: 1 })
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`
  if (seconds < 86_400 * 2) return `${(seconds / 3600).toFixed(1)} hours`
  return `${(seconds / 86_400).toFixed(1)} days`
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export function insightsFor(r: ReportResult): string[] {
  const out: string[] = []
  const fmt = (v: number) => formatValue(v, r.unit)

  if (r.shape === 'count' || r.shape === 'sum') {
    if (r.total === 0) {
      out.push(`Nothing recorded ${r.periodLabel}.`)
      return out
    }
    if (r.previousTotal >= MIN_BASE) {
      const change = (r.total - r.previousTotal) / r.previousTotal
      if (Math.abs(change) >= 0.05) {
        out.push(
          `${fmt(r.total)} — ${pct(Math.abs(change))} ${change > 0 ? 'more' : 'less'} than the period before (${fmt(r.previousTotal)}).`,
        )
      } else {
        out.push(`${fmt(r.total)} — about the same as the period before (${fmt(r.previousTotal)}).`)
      }
    } else {
      out.push(`${fmt(r.total)} ${r.periodLabel}.`)
    }

    if (r.groups && r.groups.length > 1 && r.byLabel) {
      const top = r.groups[0]
      out.push(`Top ${r.byLabel.toLowerCase()}: ${top.label} — ${pct(top.value / r.total)} (${fmt(top.value)} of ${fmt(r.total)}).`)

      const movers = r.groups
        .filter((g) => g.previous >= MIN_BASE || g.value >= MIN_BASE)
        .map((g) => ({ g, delta: g.value - g.previous }))
        .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      const m = movers[0]
      if (m && Math.abs(m.delta) >= MIN_BASE) {
        out.push(
          `Biggest ${m.delta > 0 ? 'rise' : 'drop'}: ${m.g.label}, ${m.delta > 0 ? 'up' : 'down'} ${fmt(Math.abs(m.delta))} (from ${fmt(m.g.previous)} to ${fmt(m.g.value)}).`,
        )
      }
    }

    if (r.series && r.series.length > 1 && r.bucket === 'day') {
      const peak = r.series.reduce((best, s) => (s.value > best.value ? s : best), r.series[0])
      if (peak.value > 0) out.push(`Busiest day: ${shortDay(peak.t)} (${fmt(peak.value)}).`)
    }
    return out
  }

  if (r.shape === 'from_to' && r.funnel) {
    const { all, groups, windowDays, toLabel } = r.funnel
    if (all.started === 0) {
      out.push(`Nothing to follow ${r.periodLabel}.`)
      return out
    }
    out.push(
      `${pct(all.rate)} reached "${toLabel}" within ${windowDays} days (${all.converted.toLocaleString('en-IN')} of ${all.started.toLocaleString('en-IN')}).`,
    )
    if (all.converted > 0) out.push(`Typical time to get there: ${formatDuration(all.medianSeconds)} (median).`)

    const fair = groups.filter((g) => g.started >= MIN_BASE)
    if (fair.length >= 2 && r.byLabel) {
      const best = fair.reduce((b, g) => (g.rate > b.rate ? g : b), fair[0])
      const worst = fair.reduce((w, g) => (g.rate < w.rate ? g : w), fair[0])
      if (best.key !== worst.key) {
        out.push(
          `Best ${r.byLabel.toLowerCase()}: ${best.label} at ${pct(best.rate)} (${best.converted} of ${best.started}); lowest: ${worst.label} at ${pct(worst.rate)} (${worst.converted} of ${worst.started}).`,
        )
      }
    }
    return out
  }

  if (r.shape === 'again' && r.again) {
    const { customers, returning, rate } = r.again
    if (customers === 0) {
      out.push(`Nothing recorded ${r.periodLabel}.`)
      return out
    }
    out.push(
      `${pct(rate)} of customers came back more than once (${returning.toLocaleString('en-IN')} of ${customers.toLocaleString('en-IN')}).`,
    )
    const fivePlus = r.again.distribution.find((d) => d.times === '5+')?.customers ?? 0
    if (fivePlus > 0) out.push(`${fivePlus.toLocaleString('en-IN')} came back five times or more.`)
  }
  return out
}
