/**
 * The Compare tab's pure parts (plan §3, §9): which comparisons a report
 * offers, which items from the address are allowed, per-item numbers, and
 * the one sentence code writes about the difference.
 *
 * Items in the address are only ever matched against options built from
 * the business's own data — an unknown key is dropped, never queried.
 */

import { countFunnel, type FunnelRow } from '../funnel'
import type { FunnelStage } from '../settings'

export type CompareDim = 'period' | 'agent' | 'source' | 'category' | 'number'
export const MAX_ITEMS = 4
/** Fewer leads than this on either side: no judgement, just the numbers. */
export const MIN_LEADS = 10

const BY_REPORT: Record<string, CompareDim[]> = {
  leads: ['period', 'source', 'category', 'number'],
  agents: ['period', 'agent'],
  sales: ['period', 'category', 'agent'],
  ads: ['period'],
  spending: ['period'],
}

export const DIM_LABEL: Record<CompareDim, string> = {
  period: 'Periods', agent: 'Team members', source: 'Sources', category: 'Categories', number: 'WhatsApp numbers',
}

/** Someone who sees only their own work compares only their own periods. */
export function dimsFor(reportKey: string, selfOnly: boolean): CompareDim[] {
  const dims = BY_REPORT[reportKey] ?? []
  return selfOnly ? dims.filter((d) => d === 'period') : dims
}

export interface Option { key: string; label: string }

/** Known keys only, once each, at most four; else the first two options. */
export function pickItems(raw: string | null | undefined, options: Option[]): string[] {
  const known = new Set(options.map((o) => o.key))
  const picked: string[] = []
  for (const k of (raw ?? '').split(',')) {
    const key = k.trim()
    if (key && known.has(key) && !picked.includes(key)) picked.push(key)
    if (picked.length === MAX_ITEMS) break
  }
  return picked.length ? picked : options.slice(0, 2).map((o) => o.key)
}

export interface SliceRow {
  id: string
  key: string
  day: string
  won: boolean
  lost: boolean
  replyMin: number | null
  source: string | null
}

export interface SliceStats {
  leads: number
  won: number
  lost: number
  open: number
  byDay: number[]
  replyMedian: number | null
  /** Source → leads, for a fair agent comparison (same source mix?). */
  sources: Map<string, number>
  funnel: FunnelRow[]
}

function median(v: number[]): number | null {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Per-slice numbers from lead rows and their stage marks. */
export function summarise(rows: SliceRow[], marks: Array<{ leadId: string; stageKey: string }>, stages: FunnelStage[], days: string[]): Map<string, SliceStats> {
  const groups = new Map<string, SliceRow[]>()
  for (const r of rows) {
    const g = groups.get(r.key) ?? []
    g.push(r)
    groups.set(r.key, g)
  }
  const dayIndex = new Map(days.map((d, i) => [d, i]))
  const out = new Map<string, SliceStats>()
  for (const [key, list] of groups) {
    const ids = new Set(list.map((r) => r.id))
    const byDay = days.map(() => 0)
    const sources = new Map<string, number>()
    for (const r of list) {
      const i = dayIndex.get(r.day)
      if (i !== undefined) byDay[i] += 1
      const src = r.source || 'Unknown'
      sources.set(src, (sources.get(src) ?? 0) + 1)
    }
    const won = list.filter((r) => r.won).length
    const lost = list.filter((r) => r.lost).length
    out.set(key, {
      leads: list.length, won, lost, open: list.length - won - lost, byDay,
      replyMedian: median(list.map((r) => r.replyMin).filter((m): m is number => m != null).map((m) => Math.max(0, m))),
      sources,
      funnel: countFunnel(stages, list.map((r) => ({ id: r.id, won: r.won })), marks.filter((m) => ids.has(m.leadId))),
    })
  }
  return out
}

export const wonPct = (s: SliceStats) => (s.leads > 0 ? Math.round((s.won / s.leads) * 1000) / 10 : null)

/** One sentence about the first two items, written from the numbers. */
export function compareSentence(items: Array<{ label: string; stats: SliceStats }>): string {
  if (items.length < 2) return 'Pick at least two to compare.'
  const [a, b] = items
  if (a.stats.leads < MIN_LEADS || b.stats.leads < MIN_LEADS) {
    return `Too few leads to compare fairly (fewer than ${MIN_LEADS} on one side); the numbers are shown as they are.`
  }
  const wa = wonPct(a.stats) ?? 0
  const wb = wonPct(b.stats) ?? 0
  const diff = Math.round(Math.abs(wa - wb))
  const [lo, hi] = wa < wb ? [a, b] : [b, a]
  const head = diff < 1
    ? `${a.label} and ${b.label} win about the same share of leads (${wa}%).`
    : `${lo.label}'s won % is ${diff} points lower than ${hi.label}'s (${Math.min(wa, wb)}% against ${Math.max(wa, wb)}%).`
  // The open stage where the reached share differs most.
  let gap: { label: string; pa: number; pb: number } | null = null
  for (const st of a.stats.funnel.filter((f) => f.outcome !== 'lost')) {
    const sb = b.stats.funnel.find((f) => f.key === st.key)
    if (!sb) continue
    const pa = Math.round((st.count / a.stats.leads) * 100)
    const pb = Math.round((sb.count / b.stats.leads) * 100)
    if (!gap || Math.abs(pa - pb) > Math.abs(gap.pa - gap.pb)) gap = { label: st.label, pa, pb }
  }
  if (!gap || Math.abs(gap.pa - gap.pb) < 5) return head
  return `${head} The biggest gap is at ${gap.label}: ${gap.pa}% of ${a.label}'s leads reached it against ${gap.pb}% of ${b.label}'s.`
}
