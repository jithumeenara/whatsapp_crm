"use client"

/**
 * The owner report (docs/plans/reports-plan.md Phase 1). Every number
 * comes from /api/reports/summary; this file only lays it out. Answer
 * first, then the leaks that need doing, then the detail.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { change, formatMoney, type Action } from "@/lib/reports/headline"
import type { Count, Leak, Money, ReportSummary } from "@/lib/reports/summary"
import type { FunnelRow } from "@/lib/reports/funnel"
import { ReportExportButton } from "./report-export-button"

type Kind = "today" | "week" | "month" | "custom"

interface Response {
  period: { kind: Kind; firstDay: string; lastDay: string; partial: boolean; timeZone: string }
  headline: string
  actions: Action[]
  summary: ReportSummary
}

const PERIODS: Array<{ key: Kind; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Dates" },
]

const n = (v: number) => v.toLocaleString("en-IN")
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—")
/** Below this, a percentage is shown faded: 3 of 10 says little. */
const SMALL = 20

function ago(iso: string): string {
  const h = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000))
  if (h < 1) return "under an hour"
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} days`
}

function sumMoney(list: Money[]): string {
  const real = list.filter((m) => m.amount > 0)
  return real.length ? real.map(formatMoney).join(" + ") : "—"
}

function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  const d = change(now, before)
  if (d === null || d === 0) return <span className="text-[11px] text-slate-400">{d === 0 ? "same as before" : "nothing to compare"}</span>
  const good = invert ? d < 0 : d > 0
  const Icon = d > 0 ? ArrowUp : ArrowDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? "text-emerald-700" : "text-rose-700"}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {Math.abs(d)}%<span className="sr-only">{d > 0 ? " up" : " down"}</span>
      <span className="ml-1 font-normal text-slate-400">vs before</span>
    </span>
  )
}

function Kpi({ label, value, sub, children, tone = "plain" }: { label: string; value: string; sub?: string; children?: React.ReactNode; tone?: "plain" | "good" | "bad" | "money" }) {
  const toneCls = { plain: "bg-white", good: "bg-emerald-50/60", bad: "bg-rose-50/60", money: "bg-indigo-50/60" }[tone]
  return (
    <div className={`min-w-0 rounded-2xl border border-slate-200 p-3.5 ${toneCls}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-[18px] font-bold leading-tight tabular-nums text-slate-900 sm:text-[22px]">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-slate-500">{sub}</p>}
      {children && <div className="mt-1">{children}</div>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
      {hint && <p className="mt-0.5 text-[11.5px] text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Bar({ label, value, max, right }: { label: string; value: number; max: number; right: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="min-w-0 [overflow-wrap:anywhere] text-slate-700">{label}</span>
        <span className="shrink-0 text-right tabular-nums text-slate-600">{right}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

function LeakBlock({ title, leak, href, empty }: { title: string; leak: Leak; href: (id: string) => string; empty: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-700">{title}</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${leak.count ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{n(leak.count)}</span>
      </div>
      {leak.count === 0 ? (
        <p className="mt-1 text-[12px] text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {leak.rows.map((r) => (
            <li key={r.id}>
              <Link href={href(r.id)} className="flex min-h-10 items-center justify-between gap-2 rounded-lg px-2 py-1 text-[12.5px] hover:bg-slate-50">
                <span className="min-w-0 truncate text-slate-700">{r.title}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{ago(r.since)}{r.owner ? ` · ${r.owner}` : ""}</span>
              </Link>
            </li>
          ))}
          {leak.count > leak.rows.length && <li className="px-2 text-[11px] text-slate-400">and {n(leak.count - leak.rows.length)} more</li>}
        </ul>
      )}
    </div>
  )
}

/** The business's own stages: count, share of the period's leads, and the
 *  step from the one before. Lost stages sit apart, as they are not a step. */
function FunnelView({ rows, total }: { rows: FunnelRow[]; total: number }) {
  const path = rows.filter((r) => r.outcome !== "lost")
  const lost = rows.filter((r) => r.outcome === "lost")
  const max = Math.max(1, total)
  return (
    <div className="space-y-3">
      <ol className="space-y-2.5">
        {path.map((r, i) => {
          const prev = i === 0 ? total : path[i - 1].count
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 [overflow-wrap:anywhere] font-medium text-slate-700">{r.label}{r.outcome === "won" && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 text-[10.5px] font-semibold text-emerald-700">win</span>}</span>
                <span className="shrink-0 text-right tabular-nums text-slate-600">
                  {n(r.count)} <span className="text-slate-400">· {pct(r.count, total)} of leads · {pct(r.count, prev)} from {i === 0 ? "leads" : "before"}</span>
                </span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-slate-100">
                <div className={`h-2.5 rounded-full ${r.outcome === "won" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${r.count ? Math.max(2, (r.count / max) * 100) : 0}%` }} />
              </div>
            </li>
          )
        })}
      </ol>
      {lost.length > 0 && (
        <p className="text-[12px] text-slate-500">
          {lost.map((r) => `${r.label}: ${n(r.count)}`).join(" · ")}
        </p>
      )}
    </div>
  )
}

function OutcomeSplit({ c }: { c: Count }) {
  const parts = [
    { label: "Won", v: c.won, cls: "bg-emerald-500" },
    { label: "Lost", v: c.lost, cls: "bg-rose-400" },
    { label: "Closed, no outcome", v: c.closedNoOutcome, cls: "bg-slate-300" },
    { label: "Still open", v: c.open, cls: "bg-amber-300" },
  ]
  if (c.total === 0) return <p className="text-[12.5px] text-slate-500">No leads came in during this period.</p>
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={parts.map((p) => `${p.label} ${p.v}`).join(", ")}>
        {parts.map((p) => p.v > 0 && <div key={p.label} className={p.cls} style={{ width: `${(p.v / c.total) * 100}%` }} />)}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5 text-[12px] text-slate-600">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.cls}`} aria-hidden />
            {p.label}: <span className="font-semibold tabular-nums text-slate-800">{n(p.v)}</span>
            <span className="text-slate-400">({pct(p.v, c.total)})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const KINDS: Kind[] = ["today", "week", "month", "custom"]
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** A business day key ("2026-11-02") as "2 Nov 2026". The key is already a
 *  calendar day, so it is formatted as that day, not converted. */
function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** The period lives in the address, so a reload or a shared link shows the same report. */
function readUrl(): { kind: Kind; from: string; to: string } {
  const q = new URLSearchParams(window.location.search)
  const k = q.get("period") as Kind | null
  const f = q.get("from") ?? ""
  const t = q.get("to") ?? ""
  return { kind: k && KINDS.includes(k) ? k : "week", from: DAY_RE.test(f) ? f : "", to: DAY_RE.test(t) ? t : "" }
}

export function OwnerReport() {
  const [kind, setKind] = useState<Kind>("week")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  // Read after mount, so the server's render and the first browser render agree.
  const [urlRead, setUrlRead] = useState(false)
  useEffect(() => {
    const u = readUrl()
    setKind(u.kind)
    setFrom(u.from)
    setTo(u.to)
    setUrlRead(true)
  }, [])

  useEffect(() => {
    if (!urlRead) return
    const q = new URLSearchParams(window.location.search)
    q.set("period", kind)
    if (kind === "custom" && from) q.set("from", from); else q.delete("from")
    if (kind === "custom" && to) q.set("to", to); else q.delete("to")
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`)
  }, [kind, from, to, urlRead])
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!urlRead) return
    if (kind === "custom" && (!from || !to)) return
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ period: kind })
      if (kind === "custom") { qs.set("from", from); qs.set("to", to) }
      const res = await apiFetch(`/api/reports/summary?${qs}`)
      const body = (await res.json()) as Response
      if (mine !== seq.current) return
      setData(body)
    } catch (err) {
      console.error("[reports] load failed:", err)
      if (mine === seq.current) setError(errorText(err, "Could not load the report. Try again."))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [kind, from, to, urlRead])

  useEffect(() => { void load() }, [load])

  const s = data?.summary
  const team = s?.scope === "team"
  const maxSource = Math.max(1, ...(s?.bySource.map((x) => x.total) ?? [0]))
  const maxReason = Math.max(1, ...(s?.lostReasons.map((x) => x.count) ?? [0]))
  const maxStage = Math.max(1, ...(s?.pipelineByStage.map((x) => x.amount) ?? [0]))
  const notes: string[] = []
  if (s) {
    if (s.calls.countedSince && data && new Date(s.calls.countedSince) > new Date(data.period.firstDay)) notes.push(`Calls are counted from ${new Date(s.calls.countedSince).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: data.period.timeZone })}, when call recording started.`)
    if (!s.calls.countedSince) notes.push("No calls recorded yet. Calls logged on a lead page are counted from now on.")
    if (s.wonWithoutDate) notes.push(`${n(s.wonWithoutDate)} won deals were closed before win dates were recorded and are not in any period's revenue.`)
    if (s.excluded) notes.push(`${n(s.excluded)} hidden or unconfirmed suggested leads are left out.`)
    const missing = s.revenue.reduce((a, m) => a + m.deals - m.withAmount, 0)
    if (missing) notes.push(`${n(missing)} won deals have no amount, so revenue is incomplete.`)
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-slate-900">{team || !s ? "Reports" : "My report"}</h1>
          <p className="text-[12px] text-slate-500">
            {data ? `${data.period.firstDay === data.period.lastDay ? dayLabel(data.period.firstDay) : `${dayLabel(data.period.firstDay)} to ${dayLabel(data.period.lastDay)}`} · ${data.period.timeZone}${data.period.partial ? " · so far" : ""}` : "Leads, money and what needs doing"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Period" className="flex rounded-xl border border-slate-200 bg-white p-0.5">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" aria-pressed={kind === p.key} onClick={() => setKind(p.key)}
                className={`min-h-9 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${kind === p.key ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {p.label}
              </button>
            ))}
          </div>
          {team && <ReportExportButton period={kind} from={from} to={to} disabled={loading || (kind === "custom" && (!from || !to))} />}
          <button type="button" onClick={() => void load()} aria-label="Refresh report" disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </button>
        </div>
      </header>

      {kind === "custom" && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <label className="text-[12px] font-medium text-slate-600">From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block h-10 rounded-xl border border-slate-200 px-3 text-[13px]" />
          </label>
          <label className="text-[12px] font-medium text-slate-600">To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 block h-10 rounded-xl border border-slate-200 px-3 text-[13px]" />
          </label>
          {(!from || !to) && <p className="text-[12px] text-slate-500">Choose both dates to see the report.</p>}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {!s && loading && !error && (
        <div className="flex items-center gap-2 py-16 text-[13px] text-slate-500" role="status">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Building the report…
        </div>
      )}

      {s && data && (
        <div className={`space-y-4 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[15px] font-semibold leading-snug text-slate-900">{data.headline}</p>
            {data.actions.length > 0 ? (
              <ol className="mt-3 space-y-1.5">
                {data.actions.map((a, i) => (
                  <li key={a.key} className="flex items-start gap-2 text-[13px] text-slate-700">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-800">{i + 1}</span>
                    {a.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /> Nothing is slipping right now.</p>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label="Leads" value={n(s.cohort.total)} sub="came in">
              <Delta now={s.cohort.total} before={s.previousCohort.total} />
            </Kpi>
            <Kpi label="Won" value={n(s.wonInPeriod)} sub="in this period" tone="good">
              <Delta now={s.wonInPeriod} before={s.previousWonInPeriod} />
            </Kpi>
            <Kpi label="Lost" value={n(s.lostInPeriod)} sub="in this period" tone="bad" />
            <Kpi label="Still open" value={n(s.cohort.open)} sub={`of this period's leads (${pct(s.cohort.open, s.cohort.total)})`} />
            <Kpi label="Revenue" value={sumMoney(s.revenue)} sub="won deals" tone="money" />
            <Kpi label="Pipeline" value={sumMoney(s.pipeline)} sub={`${n(s.pipeline.reduce((a, m) => a + m.deals, 0))} open deals`} tone="money" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="What became of this period's leads" hint="Leads that came in during the period, and where they are now. The parts add up to the total.">
              <OutcomeSplit c={s.cohort} />
            </Section>
            <Section title="Calls" hint={team ? "Every call outcome recorded on a lead page." : "Your recorded call outcomes."}>
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-[22px] font-bold tabular-nums text-slate-900">{n(s.calls.total)}</p><p className="text-[11.5px] text-slate-500">calls</p><Delta now={s.calls.total} before={s.calls.previousTotal} /></div>
                <div><p className="text-[22px] font-bold tabular-nums text-slate-900">{n(s.calls.connected)}</p><p className="text-[11.5px] text-slate-500">connected</p></div>
                <div><p className={`text-[22px] font-bold tabular-nums ${s.calls.total < SMALL ? "text-slate-400" : "text-slate-900"}`}>{pct(s.calls.connected, s.calls.total)}</p><p className="text-[11.5px] text-slate-500">connect rate{s.calls.total < SMALL && s.calls.total > 0 ? " (few calls)" : ""}</p></div>
              </div>
            </Section>
          </div>

          {s.funnel.length > 0 ? (
            <Section title="Your stages" hint="How far this period's leads got. A lead that skipped a step still counts as passing it.">
              <FunnelView rows={s.funnel} total={s.cohort.total} />
            </Section>
          ) : team ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-3 text-[12px] text-slate-500">
              Add your own stages (for example Appointment → Visited → Surgery) in Settings → Reports to see how far leads get here.
            </p>
          ) : null}

          <Section title="Needs doing now" hint={`Open work older than ${s.leakHours} hours, oldest first. Tap one to open it.`}>
            <div className="grid gap-3 md:grid-cols-2">
              <LeakBlock title="Never contacted" leak={s.leaks.neverContacted} href={(id) => `/leads/${id}`} empty="Every lead has been contacted." />
              <LeakBlock title="Customers waiting for a reply" leak={s.leaks.waitingChats} href={(id) => `/inbox?c=${id}`} empty="Nobody is waiting." />
              <LeakBlock title="Overdue follow-ups" leak={s.leaks.overdueFollowUps} href={(id) => `/leads/${id}`} empty="No follow-up is late." />
              {team && <LeakBlock title="No owner" leak={s.leaks.unassigned} href={(id) => `/leads/${id}`} empty="Every open lead has an owner." />}
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Where leads came from" hint="This period's leads by source, and how many were won.">
              {s.bySource.length === 0 ? <p className="text-[12.5px] text-slate-500">No leads in this period.</p> : (
                <div className="space-y-2.5">
                  {s.bySource.map((x) => <Bar key={x.source} label={x.source} value={x.total} max={maxSource} right={`${n(x.total)} · ${n(x.won)} won (${pct(x.won, x.total)})`} />)}
                </div>
              )}
            </Section>
            <Section title="Why leads were lost" hint="The reason picked when closing, in this period.">
              {s.lostReasons.length === 0 ? <p className="text-[12.5px] text-slate-500">No leads were lost in this period.</p> : (
                <div className="space-y-2.5">
                  {s.lostReasons.map((x) => <Bar key={x.reason} label={x.reason} value={x.count} max={maxReason} right={n(x.count)} />)}
                </div>
              )}
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Pipeline by stage" hint="Open deals now, in your own stages.">
              {s.pipelineByStage.length === 0 ? <p className="text-[12.5px] text-slate-500">No open deals. Add leads to a pipeline to see money waiting here.</p> : (
                <div className="space-y-2.5">
                  {s.pipelineByStage.map((x) => <Bar key={`${x.pipeline}-${x.stage}-${x.currency}`} label={`${x.stage} · ${x.pipeline}`} value={x.amount} max={maxStage} right={`${n(x.deals)} · ${formatMoney({ currency: x.currency, amount: x.amount, deals: x.deals, withAmount: x.deals })}`} />)}
                </div>
              )}
            </Section>
            <Section title="Revenue by category" hint="Won deals in this period, by what the enquiry was about.">
              {s.byCategory.length === 0 ? <p className="text-[12.5px] text-slate-500">No won deals in this period.</p> : (
                <ul className="divide-y divide-slate-100">
                  {s.byCategory.map((x) => (
                    <li key={`${x.category}-${x.currency}`} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                      <span className="min-w-0 break-words text-slate-700">{x.category} <span className="text-slate-400">({n(x.deals)})</span></span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-800">{formatMoney({ currency: x.currency, amount: x.amount, deals: x.deals, withAmount: x.deals })}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.lostAmount.some((m) => m.amount > 0) && <p className="mt-2 text-[12px] text-rose-700">Lost in deals this period: {sumMoney(s.lostAmount)}</p>}
            </Section>
          </div>

          <Section title={team ? "Team" : "My numbers"} hint={team ? "Wins go to whoever closed the lead. Percentages from fewer than 20 calls are faded." : "Only your own work is shown here."}>
            {s.agents.length === 0 ? <p className="text-[12.5px] text-slate-500">No activity in this period.</p> : (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th scope="col" className="py-2 pr-3 font-semibold">Name</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Leads</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Calls</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Connected</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Won</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Lost</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Late follow-ups</th>
                      <th scope="col" className="py-2 pr-3 text-right font-semibold">Days active</th>
                      <th scope="col" className="py-2 text-right font-semibold">First reply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.agents.map((a) => (
                      <tr key={a.userId} className="border-b border-slate-50 last:border-0">
                        <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-800">{a.name}</th>
                        <td className="py-2 pr-3 text-right tabular-nums">{n(a.leads)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{n(a.calls)}{a.daysWorked > 0 && <span className="block text-[10.5px] text-slate-400">{Math.round(a.calls / a.daysWorked)}/day</span>}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${a.calls < SMALL ? "text-slate-400" : ""}`}>{pct(a.connected, a.calls)}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums text-emerald-700">{n(a.won)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-rose-700">{n(a.lost)}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${a.overdueFollowUps ? "font-semibold text-amber-800" : ""}`}>{n(a.overdueFollowUps)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{n(a.daysWorked)}</td>
                        <td className="py-2 text-right tabular-nums">{a.medianFirstReplyMinutes == null ? "—" : a.medianFirstReplyMinutes < 60 ? `${a.medianFirstReplyMinutes} min` : `${Math.round(a.medianFirstReplyMinutes / 60)} h`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {notes.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><Info className="h-3.5 w-3.5" aria-hidden /> About these numbers</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12px] text-slate-500">
                {notes.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
