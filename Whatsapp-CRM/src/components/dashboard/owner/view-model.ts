/**
 * Pure helpers for the owner dashboard: what to show, in what order, in
 * which words. No React, no fetch, so each rule is tested on its own.
 */
import type { FunnelRow } from '@/lib/reports/funnel'
import type { Count, Money } from '@/lib/reports/summary'
import { canOpenPath } from '@/lib/auth/page-access'
import type { AccountRole } from '@/lib/auth/roles'

export type PeriodKind = 'today' | 'week' | 'month'
export type SourceRow = { source: string } & Count
/** `folded` marks the "Other" bucket made here; a real source may also be called Other. */
export type SourceBar = SourceRow & { folded?: true }

/** Biggest sources first; everything past the top N is folded into "Other". */
export function topNWithOther(rows: SourceRow[], n = 6): SourceBar[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total)
  if (sorted.length <= n) return sorted
  const rest = sorted.slice(n)
  const other: SourceBar = {
    source: 'Other',
    folded: true,
    total: 0, won: 0, lost: 0, closedNoOutcome: 0, open: 0,
  }
  for (const r of rest) {
    other.total += r.total
    other.won += r.won
    other.lost += r.lost
    other.closedNoOutcome += r.closedNoOutcome
    other.open += r.open
  }
  return [...sorted.slice(0, n), other]
}

/** One sentence naming the two neighbouring stages that lose the most leads, or null. */
/** Stored keys a sentence-case rule would get wrong. */
const SOURCE_WORDS: Record<string, string> = {
  api: 'API',
  manual: 'Added by hand',
  whatsapp: 'WhatsApp',
  whatsapp_ai: 'WhatsApp (AI)',
  ctwa: 'Click-to-WhatsApp ad',
  chatbot: 'Chatbot',
  admin_chat: 'Admin chat',
}

/** A lead source as a person reads it: "walk_in" → "Walk in". Display only;
 *  the counts are grouped by the stored key, as in Reports. */
export function sourceName(source: string | null | undefined): string {
  const raw = (source ?? '').trim()
  if (!raw) return 'Unknown'
  const known = SOURCE_WORDS[raw.toLowerCase()]
  if (known) return known
  const words = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function biggestDropSentence(funnel: FunnelRow[]): string | null {
  const path = funnel.filter((r) => r.outcome !== 'lost')
  let best: { from: FunnelRow; to: FunnelRow; lost: number } | null = null
  for (let i = 1; i < path.length; i++) {
    const lost = path[i - 1].count - path[i].count
    if (lost > 0 && (!best || lost > best.lost)) best = { from: path[i - 1], to: path[i], lost }
  }
  if (!best) return null
  return `Biggest drop: ${best.from.label} to ${best.to.label}, ${best.lost} ${best.lost === 1 ? 'lead' : 'leads'} did not go further.`
}

/** Won over all leads of the cohort; faded when the group is too small to trust. */
export function winRate(c: Count, smallNumber: number): { pct: number | null; faded: boolean } {
  if (!c.total) return { pct: null, faded: true }
  return { pct: Math.round((c.won / c.total) * 1000) / 10, faded: c.total < smallNumber }
}

/** Open deals that carry no amount, so the pipeline total is understated by them. */
export function dealsWithoutAmount(money: Money[] | null): number {
  return (money ?? []).reduce((sum, m) => sum + Math.max(0, m.deals - m.withAmount), 0)
}

/** What the change figure is measured against. */
export function comparisonLabel(kind: PeriodKind, partial: boolean): string {
  if (kind === 'today') return 'vs yesterday'
  return partial ? `vs same days last ${kind}` : `vs last ${kind}`
}

/**
 * The address when this person may open that page, otherwise null (plain text).
 * Uses the app's own rule (role default, or the explicit page list), so an
 * agent with no list is not offered admin-only pages. Unknown role: no link.
 */
export function linkOrText(href: string, role: AccountRole | null | undefined, allowedPages: string[] | null | undefined): string | null {
  if (!role) return null
  const path = href.split(/[?#]/)[0]
  return canOpenPath(role, allowedPages ?? null, path) ? href : null
}

/** "6 min", "2 h 10 min", "3 days". Null becomes an em dash. */
export function formatMinutes(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—'
  const t = Math.round(m)
  if (t < 60) return `${t} min`
  if (t < 60 * 24) {
    const h = Math.floor(t / 60)
    const r = t % 60
    return r ? `${h} h ${r} min` : `${h} h`
  }
  const d = Math.floor(t / (60 * 24))
  return `${d} ${d === 1 ? 'day' : 'days'}`
}

/** Whole minutes from `sinceMs` to `nowMs`; never negative (a browser clock behind the server), 0 when unknown. */
export function minutesSince(nowMs: number, sinceMs: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(sinceMs)) return 0
  return Math.max(0, (nowMs - sinceMs) / 60000)
}

export function periodLabel(kind: PeriodKind): string {
  return kind === 'today' ? 'Today' : kind === 'week' ? 'This week' : 'This month'
}

/** The follow-ups list behind a number. An agent's number is their own, so their link opens their own list. */
export function followUpHref(due: 'overdue' | 'today' | 'next7', view: 'owner' | 'team' | 'agent'): string {
  return `/follow-ups?due=${due}${view === 'agent' ? '&mine=1' : ''}`
}
