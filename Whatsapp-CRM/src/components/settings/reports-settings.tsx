"use client"

/**
 * Settings → Reports (docs/plans/reports-plan.md §4): the business's own
 * funnel stages, when open work counts as "needs doing", and ad spend
 * from outside Meta. One card, one Save. Everything is checked again on
 * the server (src/lib/reports/settings.ts); the form only helps.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, BarChart2, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useConfirm } from "@/hooks/use-confirm"
import { useAuth } from "@/hooks/use-auth"
import { apiFetch, errorText } from "@/lib/api-fetch"

type Outcome = "open" | "won" | "lost"
interface StageRow { id: number; key?: string; label: string; outcome: Outcome }
interface SpendRow { id: number; month: string; source: string; amount: string; currency: string }
interface Template { key: string; label: string; stages: Array<{ label: string; outcome: Outcome }> }
interface ServerState {
  funnel_stages: Array<{ key: string; label: string; outcome: Outcome }>
  report_settings: { leakHours: number | null; manualSpend: Array<{ month: string; source: string; amount: number; currency: string }> }
  sla_warn_hours: number
  templates: Template[]
}

const MAX_STAGES = 12
const MAX_SPEND_ROWS = 120
const OUTCOME_LABEL: Record<Outcome, string> = { open: "Open", won: "Won", lost: "Lost" }

let nextId = 1
const newId = () => nextId++

export function ReportsSettings() {
  const confirm = useConfirm()
  const { account } = useAuth()
  const defaultCurrency = account?.default_currency || "INR"
  const uid = useId()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [slaWarnHours, setSlaWarnHours] = useState(24)
  const [stages, setStages] = useState<StageRow[]>([])
  const [leakHours, setLeakHours] = useState("")
  const [spend, setSpend] = useState<SpendRow[]>([])
  const [savedSnapshot, setSavedSnapshot] = useState("")
  const [templatePick, setTemplatePick] = useState("")
  const savingRef = useRef(false)

  /** Fill the form from what the server holds (load and after save). */
  const apply = useCallback((d: ServerState) => {
    const st = Array.isArray(d.funnel_stages) ? d.funnel_stages.map((s) => ({ id: newId(), key: s.key, label: s.label, outcome: s.outcome })) : []
    const rs = d.report_settings ?? { leakHours: null, manualSpend: [] }
    const sp = Array.isArray(rs.manualSpend)
      ? rs.manualSpend.map((r) => ({ id: newId(), month: r.month, source: r.source, amount: String(r.amount), currency: r.currency }))
      : []
    const lh = rs.leakHours == null ? "" : String(rs.leakHours)
    setStages(st)
    setSpend(sp)
    setLeakHours(lh)
    setSlaWarnHours(typeof d.sla_warn_hours === "number" ? d.sla_warn_hours : 24)
    setTemplates(Array.isArray(d.templates) ? d.templates : [])
    setSavedSnapshot(snapshot(st, lh, sp))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await apiFetch("/api/reports/settings")
      apply((await res.json()) as ServerState)
    } catch (err) {
      console.error("[reports-settings] load failed:", err)
      setLoadError(errorText(err, "Could not load report settings."))
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => { void load() }, [load])

  const dirty = useMemo(() => snapshot(stages, leakHours, spend) !== savedSnapshot, [stages, leakHours, spend, savedSnapshot])

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  // ── Funnel ────────────────────────────────────────────────────────────
  async function applyTemplate(key: string) {
    setTemplatePick("")
    const t = templates.find((x) => x.key === key)
    if (!t) return
    if (stages.length > 0) {
      const ok = await confirm({
        title: `Replace your stages with “${t.label}”?`,
        description: "Your current list is replaced. Nothing changes until you save.",
        confirmLabel: "Replace stages",
        variant: "default",
      })
      if (!ok) return
    }
    setStages(t.stages.slice(0, MAX_STAGES).map((s) => ({ id: newId(), label: s.label, outcome: s.outcome })))
  }

  const updateStage = (id: number, patch: Partial<StageRow>) =>
    setStages((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const moveStage = (index: number, by: -1 | 1) =>
    setStages((list) => {
      const to = index + by
      if (to < 0 || to >= list.length) return list
      const next = [...list]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  const removeStage = (id: number) => setStages((list) => list.filter((s) => s.id !== id))
  const addStage = () =>
    setStages((list) => (list.length >= MAX_STAGES ? list : [...list, { id: newId(), label: "", outcome: "open" }]))

  // ── Spend ─────────────────────────────────────────────────────────────
  const updateSpend = (id: number, patch: Partial<SpendRow>) =>
    setSpend((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addSpend = () =>
    setSpend((list) =>
      list.length >= MAX_SPEND_ROWS
        ? list
        : [...list, { id: newId(), month: list[list.length - 1]?.month ?? "", source: "", amount: "", currency: defaultCurrency }],
    )
  const removeSpend = (id: number) => setSpend((list) => list.filter((r) => r.id !== id))

  // ── Save ──────────────────────────────────────────────────────────────
  async function save() {
    if (savingRef.current) return
    if (stages.some((s) => !s.label.trim())) {
      toast.error("Every stage needs a name.")
      return
    }
    if (spend.some((r) => !r.month || !r.source.trim() || r.amount.trim() === "" || !Number.isFinite(Number(r.amount)))) {
      toast.error("Each spend row needs a month, a source and an amount.")
      return
    }
    const hours = leakHours.trim()
    savingRef.current = true
    setSaving(true)
    try {
      const res = await apiFetch("/api/reports/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funnel_stages: stages.map((s) => ({ ...(s.key ? { key: s.key } : {}), label: s.label.trim(), outcome: s.outcome })),
          report_settings: {
            leakHours: hours === "" ? null : Number(hours),
            manualSpend: spend.map((r) => ({
              month: r.month,
              source: r.source.trim(),
              amount: Number(r.amount),
              currency: r.currency.trim().toUpperCase(),
            })),
          },
        }),
      })
      apply((await res.json()) as ServerState)
      toast.success("Report settings saved.")
    } catch (err) {
      console.error("[reports-settings] save failed:", err)
      toast.error(errorText(err, "Could not save report settings."))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" aria-busy="true" aria-label="Loading report settings" />
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <p className="text-[13px] text-slate-700">{loadError}</p>
        <Button variant="outline" className="mt-3" onClick={() => void load()}>Try again</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Funnel stages ─────────────────────────────────────────────── */}
      <section aria-labelledby={`${uid}-funnel`} className="rounded-2xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <h2 id={`${uid}-funnel`} className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            <BarChart2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Funnel stages
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
            The steps a lead goes through, in your own words. Agents mark them on a lead, and reports count them.
            Renaming a stage keeps its history; removing one hides it from new marks and from reports.
          </p>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-template`} className="block text-[12px] font-medium text-slate-600">
                Start from a template
              </label>
              <Select value={templatePick} onValueChange={(v) => { if (typeof v === "string" && v) void applyTemplate(v) }}>
                <SelectTrigger id={`${uid}-template`} className="h-9 w-full text-[13px] sm:w-[260px]" aria-label="Start from a template">
                  <SelectValue placeholder="Choose your kind of business" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-[11.5px] text-slate-500">Won and lost stages count in reports as wins and losses.</p>

          {stages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
              <p className="text-[13px] font-medium text-slate-700">No stages yet</p>
              <p className="mt-1 text-[12px] text-slate-500">Pick a template above or add your first stage.</p>
            </div>
          ) : (
            <ol className="space-y-2">
              {stages.map((s, i) => (
                <li key={s.id} className="rounded-xl border border-slate-200 p-2.5 sm:p-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 items-center gap-2 sm:flex-1">
                      <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-slate-400" aria-hidden="true">{i + 1}</span>
                      <Input
                        value={s.label}
                        onChange={(e) => updateStage(s.id, { label: e.target.value })}
                        maxLength={40}
                        name={`stage-${i + 1}`}
                        autoComplete="off"
                        placeholder="Stage name, e.g. Visited"
                        aria-label={`Stage ${i + 1} name`}
                        className="h-9 min-w-0 flex-1 text-[13px]"
                      />
                    </div>
                    <div className="flex items-center gap-1 pl-7 sm:pl-0">
                      <Select value={s.outcome} onValueChange={(v) => { if (v === "open" || v === "won" || v === "lost") updateStage(s.id, { outcome: v }) }}>
                        <SelectTrigger className="h-9 w-[110px] text-[13px]" aria-label={`Stage ${i + 1} outcome`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
                            <SelectItem key={o} value={o}>{OUTCOME_LABEL[o]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="ml-auto flex items-center gap-0.5 sm:ml-1">
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveStage(i, -1)} disabled={i === 0} aria-label={`Move stage ${i + 1} up`}>
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1} aria-label={`Move stage ${i + 1} down`}>
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeStage(s.id)} aria-label={`Remove stage ${i + 1}`} className="text-slate-500 hover:text-rose-700">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={addStage} disabled={stages.length >= MAX_STAGES} className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add stage
            </Button>
            <span className="text-[11.5px] tabular-nums text-slate-400">{stages.length} of {MAX_STAGES}</span>
          </div>
        </div>
      </section>

      {/* ── Needs doing ───────────────────────────────────────────────── */}
      <section aria-labelledby={`${uid}-leak`} className="rounded-2xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <h2 id={`${uid}-leak`} className="text-[15px] font-semibold text-slate-800">Needs doing</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
            How long open work can wait before the report lists it as needing attention.
          </p>
        </div>
        <div className="space-y-1.5 p-4 sm:p-5">
          <label htmlFor={`${uid}-hours`} className="block text-[12px] font-medium text-slate-600">Hours</label>
          <div className="flex items-center gap-2">
            <Input
              id={`${uid}-hours`}
              name="leak-hours"
              autoComplete="off"
              type="number"
              inputMode="numeric"
              min={1}
              max={720}
              step={1}
              value={leakHours}
              onChange={(e) => setLeakHours(e.target.value)}
              placeholder={String(slaWarnHours)}
              aria-describedby={`${uid}-hours-hint`}
              className="h-9 w-24 text-[13px] tabular-nums"
            />
            <span className="text-[12px] text-slate-500">hours</span>
          </div>
          <p id={`${uid}-hours-hint`} className="text-[11.5px] text-slate-500">
            Leave empty to use your Leads SLA warning ({slaWarnHours} {slaWarnHours === 1 ? "hour" : "hours"}). From 1 to 720.
          </p>
        </div>
      </section>

      {/* ── Manual ad spend ───────────────────────────────────────────── */}
      <section aria-labelledby={`${uid}-spend`} className="rounded-2xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <h2 id={`${uid}-spend`} className="text-[15px] font-semibold text-slate-800">Ad spend from outside Meta</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
            For ads not connected to Meta, such as newspaper, Google or posters. It is used for cost per lead in reports.
          </p>
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          {spend.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
              <p className="text-[13px] font-medium text-slate-700">No spend added</p>
              <p className="mt-1 text-[12px] text-slate-500">Add a row for each month and source you paid for.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {spend.map((r, i) => (
                <li key={r.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[180px_minmax(0,1fr)_120px_80px_auto] sm:items-end">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <label htmlFor={`${uid}-m-${r.id}`} className="mb-1 block text-[11.5px] text-slate-500">Month</label>
                      <Input id={`${uid}-m-${r.id}`} type="month" name="spend-month" autoComplete="off" value={r.month} onChange={(e) => updateSpend(r.id, { month: e.target.value })} className="h-9 text-[13px]" />
                    </div>
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <label htmlFor={`${uid}-s-${r.id}`} className="mb-1 block text-[11.5px] text-slate-500">Source</label>
                      <Input id={`${uid}-s-${r.id}`} name="spend-source" autoComplete="off" value={r.source} maxLength={40} onChange={(e) => updateSpend(r.id, { source: e.target.value })} placeholder="e.g. Newspaper" className="h-9 text-[13px]" />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={`${uid}-a-${r.id}`} className="mb-1 block text-[11.5px] text-slate-500">Amount</label>
                      <Input id={`${uid}-a-${r.id}`} type="number" name="spend-amount" autoComplete="off" inputMode="decimal" min={0} step="0.01" value={r.amount} onChange={(e) => updateSpend(r.id, { amount: e.target.value })} placeholder="0" className="h-9 text-[13px] tabular-nums" />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={`${uid}-c-${r.id}`} className="mb-1 block text-[11.5px] text-slate-500">Currency</label>
                      <Input id={`${uid}-c-${r.id}`} name="spend-currency" autoComplete="off" value={r.currency} maxLength={3} autoCapitalize="characters" spellCheck={false} onChange={(e) => updateSpend(r.id, { currency: e.target.value.toUpperCase() })} className="h-9 text-[13px] uppercase" />
                    </div>
                    <div className="col-span-2 flex justify-end sm:col-span-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeSpend(r.id)} aria-label={`Remove spend row ${i + 1}`} className="gap-1.5 text-slate-500 hover:text-rose-700">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span className="sm:sr-only">Remove</span>
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button type="button" variant="outline" onClick={addSpend} disabled={spend.length >= MAX_SPEND_ROWS} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add spend
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty && (
          <>
            <span className="text-[12px] text-slate-500" aria-live="polite">Unsaved changes</span>
            <Button type="button" variant="ghost" onClick={() => void load()} disabled={saving}>Discard</Button>
          </>
        )}
        <Button type="button" onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {saving ? "Saving…" : "Save report settings"}
        </Button>
      </div>
    </div>
  )
}

function snapshot(stages: StageRow[], leakHours: string, spend: SpendRow[]): string {
  return JSON.stringify([
    stages.map((s) => [s.key ?? "", s.label, s.outcome]),
    leakHours.trim(),
    spend.map((r) => [r.month, r.source, r.amount, r.currency]),
  ])
}
