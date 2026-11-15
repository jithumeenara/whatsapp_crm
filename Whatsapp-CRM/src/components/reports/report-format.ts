/**
 * How report numbers read on screen. A ReportDoc carries raw numbers with
 * a `Fmt`; this turns them into text with Intl (never a hand-made
 * pattern). Percent values are already in percent units (55.9 = 55.9%).
 */

import type { Compared, Fmt } from "@/lib/reports/doc/types"
import { changeLabel, judgeChange } from "@/lib/reports/doc/change"

const LOCALE = "en-IN"

const intCache = new Map<number, Intl.NumberFormat>()
function nf(digits: number): Intl.NumberFormat {
  let f = intCache.get(digits)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits })
    intCache.set(digits, f)
  }
  return f
}

function money(v: number, currency: string, compact = false): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      // Whole amounts never show ".00"; paise only on small odd amounts.
      maximumFractionDigits: compact || Math.abs(v) >= 100 || Number.isInteger(v) ? 0 : 2,
      minimumFractionDigits: 0,
      notation: compact ? "compact" : "standard",
    }).format(v)
  } catch {
    // An unknown currency code: the number with the code beside it.
    return `${currency} ${nf(2).format(v)}`
  }
}

function minutes(v: number): string {
  const total = Math.round(v)
  if (Math.abs(total) < 60) return `${nf(0).format(total)} min`
  const h = Math.trunc(total / 60)
  const m = Math.abs(total % 60)
  return m ? `${nf(0).format(h)} h ${m} min` : `${nf(0).format(h)} h`
}

/** A number as the report means it. */
export function formatValue(v: number | null | undefined, fmt?: Fmt): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  switch (fmt?.kind) {
    case "percent": return `${nf(fmt.digits ?? 1).format(v)}%`
    case "money": return money(v, fmt.currency)
    case "minutes": return minutes(v)
    case "text": return String(v)
    case "count":
    default: return nf(1).format(v)
  }
}

const compactNf = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 })

/** Short axis ticks: "1.2K", "₹15K", "45%". */
export function formatTick(v: number, fmt?: Fmt): string {
  if (!Number.isFinite(v)) return ""
  switch (fmt?.kind) {
    case "percent": return `${nf(0).format(v)}%`
    case "money": return money(v, fmt.currency, true)
    case "minutes": return `${compactNf.format(v)}m`
    default: return compactNf.format(v)
  }
}

export interface CompareText {
  before: string
  /** "+35%", "−12%", "+3.2 pts", "±0%", or null when there is nothing to compare. */
  change: string | null
  state: "good" | "bad" | "same" | "small" | "none"
}

/** "Before: 105 · +35%": the sign is always written, so colour is never
 *  the only signal. The rule itself (too few, points, "N× before") is
 *  shared with the PDF, slides and workbook: src/lib/reports/doc/change.ts. */
export function compareText(c: Compared & { fmt: Fmt }): CompareText {
  const before = formatValue(c.before, c.fmt)
  const ch = judgeChange(c)
  const change = changeLabel(ch, (v) => formatValue(v, c.fmt))
  if (ch.kind === "none") return { before, change: null, state: "none" }
  if (ch.kind === "small") return { before, change, state: "small" }
  if (ch.kind === "same") return { before, change, state: "same" }
  return { before, change, state: ch.tone === "good" ? "good" : "bad" }
}

/** A calendar day ("2026-11-03") as "3 Nov 2026"; anything else as given. */
export function formatDay(day: string, opts: { year?: boolean } = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "")
  if (!m) return day ?? ""
  // A calendar day has no zone: read and print it in UTC so it never shifts.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric", month: "short", year: opts.year === false ? undefined : "numeric", timeZone: "UTC",
  }).format(d)
}

export function formatRange(first: string, last: string): string {
  if (!first && !last) return ""
  if (first === last || !last) return formatDay(first)
  const sameYear = first.slice(0, 4) === last.slice(0, 4)
  return `${formatDay(first, { year: !sameYear })} – ${formatDay(last)}`
}

/** Only links inside this app ("/leads/1"), never "//host" or "javascript:". */
export function safeInternalHref(href: string | undefined): string | null {
  if (!href || typeof href !== "string") return null
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return null
  return href
}
