/**
 * The Reports area keeps its whole state in the address: which period,
 * which dates, which comparison and which tab. That way it survives a
 * refresh, a shared link and moving between reports in the side menu.
 *
 * Defaults are `period=week`, `compare=previous`, `tab=report`; they are
 * left out of links so a plain /reports/leads still means "this week".
 */

export const PERIODS = [
  "today", "week", "month", "yesterday", "last_week", "last_month", "last_7", "last_30", "year", "custom",
] as const
export type PeriodKey = (typeof PERIODS)[number]

export const COMPARES = ["previous", "year", "none"] as const
export type CompareKey = (typeof COMPARES)[number]

export type TabKey = "report" | "compare"

export interface ReportQuery {
  period: PeriodKey
  /** YYYY-MM-DD; only meaningful when period is "custom". */
  from: string
  to: string
  compare: CompareKey
  tab: TabKey
  /** One team member's Agent report card (supervisors). Kept on period
   *  and tab changes and on exports; links to other reports drop it. The
   *  server decides whether it may be used. */
  member?: string
}

const MEMBER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const DEFAULT_PERIOD: PeriodKey = "week"
export const DEFAULT_COMPARE: CompareKey = "previous"

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function isDay(v: string | null | undefined): v is string {
  return !!v && DAY.test(v)
}

interface ParamsLike {
  get(name: string): string | null
}

/** Read the address. Anything unknown falls back to the default, and a
 *  custom period without two valid dates in order falls back to the week. */
export function readQuery(sp: ParamsLike | null): ReportQuery {
  const rawPeriod = sp?.get("period") ?? ""
  const rawCompare = sp?.get("compare") ?? ""
  let period: PeriodKey = (PERIODS as readonly string[]).includes(rawPeriod) ? (rawPeriod as PeriodKey) : DEFAULT_PERIOD
  const compare: CompareKey = (COMPARES as readonly string[]).includes(rawCompare) ? (rawCompare as CompareKey) : DEFAULT_COMPARE
  const from = sp?.get("from") ?? ""
  const to = sp?.get("to") ?? ""
  if (period === "custom" && !(isDay(from) && isDay(to) && from <= to)) period = DEFAULT_PERIOD
  const tab: TabKey = sp?.get("tab") === "compare" ? "compare" : "report"
  const rawMember = sp?.get("member") ?? ""
  const member = MEMBER.test(rawMember) ? rawMember : ""
  return { period, from: period === "custom" ? from : "", to: period === "custom" ? to : "", compare, tab, member }
}

/** The query string for links between reports (no leading "?"). Defaults
 *  are left out; the tab only when asked, since not every report has one. */
export function queryString(q: ReportQuery, opts: { tab?: boolean } = {}): string {
  const p = new URLSearchParams()
  if (q.period !== DEFAULT_PERIOD) p.set("period", q.period)
  if (q.period === "custom") {
    p.set("from", q.from)
    p.set("to", q.to)
  }
  if (q.compare !== DEFAULT_COMPARE) p.set("compare", q.compare)
  if (opts.tab && q.tab !== "report") p.set("tab", q.tab)
  return p.toString()
}

/** `path` with the current period carried over. */
export function withQuery(path: string, q: ReportQuery, opts: { tab?: boolean } = {}): string {
  const qs = queryString(q, opts)
  if (!qs) return path
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`
}

/** The API's query: always explicit, so the server never guesses. */
export function apiQuery(q: ReportQuery, format: "json" | "pdf" | "xlsx" | "pptx"): string {
  const p = new URLSearchParams({ period: q.period })
  if (q.period === "custom") {
    p.set("from", q.from)
    p.set("to", q.to)
  }
  p.set("compare", q.compare)
  if (q.tab !== "report") p.set("tab", q.tab)
  if (q.member) p.set("member", q.member)
  p.set("format", format)
  return p.toString()
}

/** One entry of GET /api/reports/doc. */
export interface ReportMenuItem {
  key: string
  title: string
  group: "overview" | "topic" | "analysis"
  path: string
  exports: Array<"pdf" | "xlsx" | "pptx">
  tabs: Array<"report" | "compare">
}
