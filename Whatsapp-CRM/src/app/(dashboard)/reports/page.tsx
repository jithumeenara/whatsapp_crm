"use client"

/**
 * Reports — a sentence, not a form.
 *
 * Every report here is one sentence about moments (src/lib/reports):
 * "How many [leads won] by [source] — [this month]", "[Leads created] →
 * [leads won] within [90] days by [team member]". The sentence is built
 * from dropdowns, runs as it changes, and is what gets saved, exported and
 * read out as the report's title. Nothing on this page is specific to one
 * kind of business: an institute, a clinic and a shop see the same four
 * questions over their own moments, including their own Data Store tables.
 *
 * The automatic insights are written by rules from the numbers on the
 * screen — no AI is involved, and nothing leaves the CRM to make them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  BarChart2, Lightbulb, Download, Save, Trash2, Plus, X, Loader2, Sparkles, Bookmark, ArrowRight, Lock,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { ConfirmIconDialog } from "@/components/ui/confirm-icon-dialog"
import type { ReportResult, ReportSpec, Shape } from "@/lib/reports/engine"
import { formatDuration, formatValue } from "@/lib/reports/insights"

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

// ── catalog types ──────────────────────────────────────────────────────

interface MomentOption {
  kind: string
  label: string
  group: string
  props: { key: string; label: string }[]
  values: { key: string; label: string; unit: "INR" | "min" | null }[]
}
interface Catalog {
  moments: MomentOption[]
  periods: { key: string; label: string }[]
  presets: { id: string; title: string; description: string; spec: ReportSpec }[]
  saved: { id: string; name: string; spec: ReportSpec }[]
  timezone: string
}

const SHAPE_LABEL: Record<Shape, string> = {
  count: "How many",
  sum: "How much",
  from_to: "From → to",
  again: "Came back again",
}

const WINDOWS = [7, 30, 60, 90, 180, 365]
const CARD = "rounded-2xl border border-slate-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]"
const SELECT = "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
const TOOLTIP = {
  contentStyle: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: "10px", fontSize: "12px" },
  labelStyle: { color: "#475569", fontWeight: 600 },
}
const INDIGO = "#6366f1"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function axisDay(t: string, bucket?: string) {
  const [y, m, d] = t.split("-").map(Number)
  if (bucket === "month") return `${MONTHS[m - 1]} ${String(y).slice(2)}`
  return `${d} ${MONTHS[m - 1]}`
}

const pct = (x: number) => `${Math.round(x * 100)}%`

function defaultSpec(): ReportSpec {
  return { v: 1, shape: "count", moment: "lead.created", by: "source", period: { preset: "last_30_days" }, filters: [] }
}

// ── the sentence ───────────────────────────────────────────────────────

function MomentSelect({ moments, value, onChange, exclude }: {
  moments: MomentOption[]; value: string; onChange: (v: string) => void; exclude?: string
}) {
  const groups = useMemo(() => {
    const map = new Map<string, MomentOption[]>()
    for (const m of moments) {
      if (m.kind === exclude) continue
      map.set(m.group, [...(map.get(m.group) ?? []), m])
    }
    return [...map]
  }, [moments, exclude])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(SELECT, "max-w-[260px]")} aria-label="Moment">
      {groups.map(([g, list]) => (
        <optgroup key={g} label={g}>
          {list.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function Word({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] text-slate-500">{children}</span>
}

// ── page ───────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { accountRole } = useAuth()
  const allowed = !!accountRole && hasMinRole(accountRole, "supervisor")

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [spec, setSpec] = useState<ReportSpec>(defaultSpec)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [insights, setInsights] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [filterOptions, setFilterOptions] = useState<Record<string, { key: string; label: string }[]>>({})
  const runSeq = useRef(0)

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/catalog")
      const data = await res.json()
      if (!res.ok) { setCatalogError(data.error ?? "Could not load reports."); return }
      setCatalog(data)
    } catch {
      setCatalogError("Could not load reports.")
    }
  }, [])

  useEffect(() => { if (allowed) loadCatalog() }, [allowed, loadCatalog])

  const moment = catalog?.moments.find((m) => m.kind === spec.moment)

  // Run whenever the sentence changes; only the newest answer is shown.
  useEffect(() => {
    if (!catalog || !moment) return
    const seq = ++runSeq.current
    setRunning(true)
    setRunError(null)
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/reports/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec }),
        })
        const data = await res.json()
        if (seq !== runSeq.current) return
        if (!res.ok) { setRunError(data.error ?? "The report could not run."); setResult(null); return }
        setResult(data.result)
        setInsights(data.insights ?? [])
      } catch {
        if (seq === runSeq.current) setRunError("The report could not run — check the connection.")
      } finally {
        if (seq === runSeq.current) setRunning(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [spec, catalog, moment])

  // Options for a filter's value: the values that detail actually has.
  const loadFilterOptions = useCallback(async (prop: string) => {
    const key = `${spec.moment}|${prop}`
    if (filterOptions[key]) return
    try {
      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: { v: 1, shape: "count", moment: spec.moment, by: prop, period: { preset: "last_12_months" } } }),
      })
      const data = await res.json()
      if (res.ok) {
        const opts = ((data.result as ReportResult).groups ?? []).map((g) => ({ key: g.key, label: g.label }))
        setFilterOptions((o) => ({ ...o, [key]: opts }))
      }
    } catch { /* the select just stays empty */ }
  }, [spec.moment, filterOptions])

  function update(patch: Partial<ReportSpec>) {
    setSpec((s) => ({ ...s, ...patch }))
  }

  function changeMoment(kind: string) {
    const m = catalog?.moments.find((x) => x.kind === kind)
    setSpec((s) => ({
      ...s,
      moment: kind,
      by: m?.props.some((p) => p.key === s.by) ? s.by : null,
      value: s.shape === "sum" ? m?.values[0]?.key : undefined,
      filters: [],
      shape: s.shape === "sum" && !m?.values.length ? "count" : s.shape,
      to: s.to === kind ? undefined : s.to,
    }))
  }

  function changeShape(shape: Shape) {
    setSpec((s) => {
      const next: ReportSpec = { ...s, shape }
      if (shape === "sum") next.value = moment?.values[0]?.key
      if (shape === "from_to") {
        next.to = s.to && s.to !== s.moment ? s.to : catalog?.moments.find((m) => m.kind !== s.moment && m.kind === "lead.won")?.kind
          ?? catalog?.moments.find((m) => m.kind !== s.moment)?.kind
        next.window_days = s.window_days ?? 90
      }
      if (shape === "again") next.by = null
      return next
    })
  }

  async function exportExcel() {
    setExporting(true)
    try {
      const res = await fetch("/api/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Export failed.")
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") ?? ""
      const match = /filename\*=UTF-8''([^;]+)/.exec(disposition)
      const name = match ? decodeURIComponent(match[1]) : "Report.xlsx"
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success("Excel downloaded.")
    } catch {
      toast.error("Export failed — check the connection.")
    } finally {
      setExporting(false)
    }
  }

  async function saveReport() {
    const name = (saveName ?? "").trim()
    if (!name) { toast.error("Give the report a name."); return }
    setSaving(true)
    try {
      const res = await fetch("/api/reports/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, spec }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Could not save."); return }
      toast.success("Report saved.")
      setSaveName(null)
      await loadCatalog()
    } catch {
      toast.error("Could not save — check the connection.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteSaved() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/reports/saved?id=${encodeURIComponent(deleteId)}`, { method: "DELETE" })
      if (!res.ok) { toast.error("Could not delete."); return }
      toast.success("Saved report deleted.")
      setDeleteId(null)
      await loadCatalog()
    } finally {
      setDeleting(false)
    }
  }

  if (accountRole && !allowed) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className={cn(CARD, "max-w-sm p-6 text-center")}>
          <Lock className="mx-auto mb-2 h-6 w-6 text-slate-400" />
          <p className="text-[14px] font-semibold text-slate-800">Reports are for supervisors and above</p>
          <p className="mt-1 text-[12.5px] text-slate-500">They show the whole team’s numbers. Ask an administrator if you need one.</p>
        </div>
      </div>
    )
  }

  const isCustom = !!(spec.period.from || spec.period.to)
  const unit = result?.unit ?? null

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50">
          <BarChart2 className="h-5 w-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-[20px] font-bold text-slate-900">Reports</h1>
          <p className="text-[12px] text-slate-500">Ask a question as a sentence — every number comes straight from your data.</p>
        </div>
      </div>

      {catalogError && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">{catalogError}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* ── Ready and saved reports ── */}
        <aside className="space-y-6">
          <div className={cn(CARD, "p-4")}>
            <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" /> Ready reports
            </h2>
            <div className="space-y-1">
              {(catalog?.presets ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.description}
                  onClick={() => setSpec({ ...p.spec, filters: p.spec.filters ?? [] })}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-50"
                >
                  {p.title}
                </button>
              ))}
              {!catalog && <div className="h-40 animate-pulse rounded-lg bg-slate-50" />}
            </div>
          </div>

          <div className={cn(CARD, "p-4")}>
            <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
              <Bookmark className="h-3.5 w-3.5 text-indigo-500" /> Saved
            </h2>
            {(catalog?.saved ?? []).length === 0 ? (
              <p className="px-1 text-[12px] text-slate-400">Reports you save appear here for the whole team.</p>
            ) : (
              <div className="space-y-1">
                {catalog!.saved.map((s) => (
                  <div key={s.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSpec({ ...s.spec, filters: s.spec.filters ?? [] })}
                      className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-50"
                    >
                      {s.name}
                    </button>
                    <button type="button" aria-label={`Delete ${s.name}`} onClick={() => setDeleteId(s.id)}
                      className="rounded p-1 text-slate-300 opacity-0 hover:text-rose-500 group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ── The sentence and its answer ── */}
        <main className="min-w-0 space-y-6">
          <div className={cn(CARD, "p-4 sm:p-5")}>
            {catalog && moment ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={spec.shape} onChange={(e) => changeShape(e.target.value as Shape)} className={cn(SELECT, "font-semibold text-indigo-700")} aria-label="Question">
                    {(Object.keys(SHAPE_LABEL) as Shape[]).map((s) => (
                      <option key={s} value={s} disabled={s === "sum" && !moment.values.length}>{SHAPE_LABEL[s]}</option>
                    ))}
                  </select>

                  {spec.shape === "sum" && (
                    <>
                      <select value={spec.value ?? ""} onChange={(e) => update({ value: e.target.value })} className={SELECT} aria-label="Number to add up">
                        {moment.values.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                      </select>
                      <Word>of</Word>
                    </>
                  )}

                  <MomentSelect moments={catalog.moments} value={spec.moment} onChange={changeMoment} />

                  {spec.shape === "from_to" && (
                    <>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                      <MomentSelect moments={catalog.moments} value={spec.to ?? ""} onChange={(v) => update({ to: v })} exclude={spec.moment} />
                      <Word>within</Word>
                      <select value={spec.window_days ?? 90} onChange={(e) => update({ window_days: Number(e.target.value) })} className={SELECT} aria-label="Within days">
                        {WINDOWS.map((w) => <option key={w} value={w}>{w} days</option>)}
                      </select>
                    </>
                  )}

                  {spec.shape !== "again" && moment.props.length > 0 && (
                    <>
                      <Word>by</Word>
                      <select value={spec.by ?? ""} onChange={(e) => update({ by: e.target.value || null })} className={SELECT} aria-label="Split by">
                        <option value="">— nothing —</option>
                        {moment.props.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    </>
                  )}

                  <Word>—</Word>
                  <select
                    value={isCustom ? "custom" : spec.period.preset ?? "last_30_days"}
                    onChange={(e) => {
                      if (e.target.value === "custom") {
                        const today = new Date().toISOString().slice(0, 10)
                        update({ period: { from: `${today.slice(0, 8)}01`, to: today } })
                      } else update({ period: { preset: e.target.value as ReportSpec["period"]["preset"] } })
                    }}
                    className={SELECT}
                    aria-label="Period"
                  >
                    {catalog.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    <option value="custom">between dates…</option>
                  </select>
                  {isCustom && (
                    <>
                      <input id="report-from" type="date" value={spec.period.from ?? ""} onChange={(e) => update({ period: { ...spec.period, from: e.target.value } })} className={SELECT} aria-label="From" />
                      <Word>to</Word>
                      <input id="report-to" type="date" value={spec.period.to ?? ""} onChange={(e) => update({ period: { ...spec.period, to: e.target.value } })} className={SELECT} aria-label="To" />
                    </>
                  )}
                </div>

                {/* Filters */}
                {(spec.filters ?? []).map((f, i) => {
                  const optKey = `${spec.moment}|${f.prop}`
                  return (
                    <div key={i} className="mt-2 flex flex-wrap items-center gap-2">
                      <Word>where</Word>
                      <select
                        value={f.prop}
                        onChange={(e) => {
                          const filters = [...(spec.filters ?? [])]
                          filters[i] = { prop: e.target.value, value: "" }
                          update({ filters })
                          loadFilterOptions(e.target.value)
                        }}
                        className={SELECT}
                        aria-label="Filter detail"
                      >
                        {moment.props.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                      <Word>is</Word>
                      <select
                        value={f.value}
                        onFocus={() => loadFilterOptions(f.prop)}
                        onChange={(e) => {
                          const filters = [...(spec.filters ?? [])]
                          filters[i] = { ...f, value: e.target.value }
                          update({ filters })
                        }}
                        className={cn(SELECT, "max-w-[220px]")}
                        aria-label="Filter value"
                      >
                        <option value="">Choose…</option>
                        {(filterOptions[optKey] ?? []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                      <button type="button" aria-label="Remove filter" onClick={() => update({ filters: (spec.filters ?? []).filter((_, j) => j !== i) })}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  {moment.props.length > 0 && (spec.filters ?? []).length < 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        const prop = moment.props[0].key
                        update({ filters: [...(spec.filters ?? []), { prop, value: "" }] })
                        loadFilterOptions(prop)
                      }}
                      className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> Filter
                    </button>
                  )}
                  <div className="flex-1" />
                  {saveName === null ? (
                    <button type="button" onClick={() => setSaveName(result?.title.split(" — ")[0] ?? "")}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50">
                      <Save className="h-3.5 w-3.5" /> Save
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input id="report-save-name" autoFocus value={saveName} maxLength={80} onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveReport(); if (e.key === "Escape") setSaveName(null) }}
                        placeholder="Report name" className={cn(SELECT, "w-56")} />
                      <button type="button" onClick={saveReport} disabled={saving}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button type="button" aria-label="Cancel" onClick={() => setSaveName(null)} className="rounded p-1 text-slate-400 hover:text-slate-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <button type="button" onClick={exportExcel} disabled={exporting || !result}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                    {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Excel
                  </button>
                </div>
              </>
            ) : (
              <div className="h-24 animate-pulse rounded-lg bg-slate-50" />
            )}
          </div>

          {runError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">{runError}</div>
          )}

          {result && (
            <div className={cn(CARD, "p-4 sm:p-5", running && "opacity-60 transition-opacity")}>
              <h2 className="text-[16px] font-semibold text-slate-900 [text-wrap:balance]">{result.title}</h2>

              {/* Headline numbers */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(result.shape === "count" || result.shape === "sum") && (
                  <>
                    <Stat label="This period" value={formatValue(result.total, unit)} />
                    <Stat label="Period before" value={formatValue(result.previousTotal, unit)} />
                    <Stat
                      label="Change"
                      value={result.previousTotal ? `${result.total >= result.previousTotal ? "+" : "−"}${pct(Math.abs(result.total - result.previousTotal) / result.previousTotal)}` : "—"}
                      tone={result.total >= result.previousTotal ? "up" : "down"}
                    />
                  </>
                )}
                {result.funnel && (
                  <>
                    <Stat label="Started" value={result.funnel.all.started.toLocaleString("en-IN")} />
                    <Stat label={`Reached “${result.funnel.toLabel}”`} value={result.funnel.all.converted.toLocaleString("en-IN")} />
                    <Stat label="Rate" value={pct(result.funnel.all.rate)} />
                    <Stat label="Typical time" value={formatDuration(result.funnel.all.medianSeconds)} />
                  </>
                )}
                {result.again && (
                  <>
                    <Stat label="Customers" value={result.again.customers.toLocaleString("en-IN")} />
                    <Stat label="Came back" value={result.again.returning.toLocaleString("en-IN")} />
                    <Stat label="Rate" value={pct(result.again.rate)} />
                  </>
                )}
              </div>

              {/* Insights */}
              {insights.length > 0 && (
                <div className="mt-4 rounded-xl bg-indigo-50/60 p-3.5">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-indigo-700">
                    <Lightbulb className="h-3.5 w-3.5" /> What stands out
                  </p>
                  <ul className="space-y-1">
                    {insights.map((line, i) => <li key={i} className="text-[13px] text-slate-700">{line}</li>)}
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-400">Written automatically from the numbers above — no AI.</p>
                </div>
              )}

              <ResultChart result={result} />
              <ResultTable result={result} />
            </div>
          )}
        </main>
      </div>

      <ConfirmIconDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null) }}
        icon={Trash2}
        tone="danger"
        title="Delete this saved report?"
        description="Only the saved sentence is removed — no data changes."
        actionLabel="Delete"
        actionPendingLabel="Deleting…"
        onConfirm={deleteSaved}
        pending={deleting}
      />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="truncate text-[11.5px] text-slate-500" title={label}>{label}</p>
      <p className={cn("mt-1 text-[20px] font-bold tabular-nums",
        tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-slate-900")}>
        {value}
      </p>
    </div>
  )
}

function ResultChart({ result }: { result: ReportResult }) {
  const unit = result.unit
  if (result.series) {
    const data = result.series.map((p) => ({ t: axisDay(p.t, result.bucket), Value: p.value }))
    return (
      <div className="mt-5">
        <ResponsiveContainer width="100%" height={240} initialDimension={{ width: 1, height: 240 }}>
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
            <defs>
              <linearGradient id="report-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={INDIGO} stopOpacity={0.2} />
                <stop offset="100%" stopColor={INDIGO} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={unit !== null} />
            <Tooltip {...TOOLTIP} formatter={(v) => [formatValue(Number(v), unit), "Value"]} />
            <Area type="monotone" dataKey="Value" stroke={INDIGO} strokeWidth={2.5} fill="url(#report-area)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )
  }

  const bars = result.groups
    ? result.groups.slice(0, 12).map((g) => ({ name: g.label, v: g.value }))
    : result.funnel
      ? result.funnel.groups.slice(0, 12).map((g) => ({ name: g.label, v: Math.round(g.rate * 100) }))
      : result.again
        ? result.again.distribution.map((d) => ({ name: `${d.times}×`, v: d.customers }))
        : []
  if (bars.length === 0) return null
  const isRate = !!result.funnel
  const horizontal = !result.again
  return (
    <div className="mt-5">
      <ResponsiveContainer width="100%" height={horizontal ? Math.max(160, bars.length * 32 + 30) : 220} initialDimension={{ width: 1, height: 200 }}>
        {horizontal ? (
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} domain={isRate ? [0, 100] : undefined} unit={isRate ? "%" : undefined} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11.5, fill: "#475569" }} tickLine={false} axisLine={false} />
            <Tooltip {...TOOLTIP} formatter={(v) => [isRate ? `${v}%` : formatValue(Number(v), unit), isRate ? "Rate" : "Value"]} cursor={{ fill: "#f8fafc" }} />
            <Bar dataKey="v" fill={INDIGO} radius={[0, 6, 6, 0]} maxBarSize={22} />
          </BarChart>
        ) : (
          <BarChart data={bars} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP} formatter={(v) => [Number(v).toLocaleString("en-IN"), "Customers"]} cursor={{ fill: "#f8fafc" }} />
            <Bar dataKey="v" fill={INDIGO} radius={[6, 6, 0, 0]} maxBarSize={44} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function ResultTable({ result }: { result: ReportResult }) {
  const unit = result.unit
  const th = "px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-slate-500"
  const td = "px-3 py-2 text-[13px] text-slate-700 tabular-nums"

  if (result.groups && result.groups.length) {
    return (
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[420px]">
          <thead className="bg-slate-50"><tr>
            <th className={th}>{result.byLabel}</th><th className={th}>This period</th><th className={th}>Period before</th><th className={th}>Change</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {result.groups.map((g) => (
              <tr key={g.key}>
                <td className={cn(td, "max-w-[260px] truncate")} title={g.label}>{g.label}</td>
                <td className={td}>{formatValue(g.value, unit)}</td>
                <td className={cn(td, "text-slate-500")}>{formatValue(g.previous, unit)}</td>
                <td className={td}>{g.previous ? `${g.value >= g.previous ? "+" : "−"}${pct(Math.abs(g.value - g.previous) / g.previous)}` : "—"}</td>
              </tr>
            ))}
            {result.other ? (
              <tr><td className={cn(td, "text-slate-500")}>Everything else</td><td className={td}>{formatValue(result.other, unit)}</td><td /><td /></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    )
  }

  if (result.funnel && result.funnel.groups.length) {
    return (
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[480px]">
          <thead className="bg-slate-50"><tr>
            <th className={th}>{result.byLabel}</th><th className={th}>Started</th><th className={th}>Reached</th><th className={th}>Rate</th><th className={th}>Typical time</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {result.funnel.groups.map((g) => (
              <tr key={g.key}>
                <td className={cn(td, "max-w-[260px] truncate")} title={g.label}>{g.label}</td>
                <td className={td}>{g.started.toLocaleString("en-IN")}</td>
                <td className={td}>{g.converted.toLocaleString("en-IN")}</td>
                <td className={td}>{pct(g.rate)}</td>
                <td className={cn(td, "text-slate-500")}>{formatDuration(g.medianSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return null
}
