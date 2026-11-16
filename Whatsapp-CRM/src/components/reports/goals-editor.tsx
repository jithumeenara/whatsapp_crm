"use client"

/**
 * Reports → Goals (phase F2): owners and admins set goals for the team or
 * one member, for the running week or month. Progress shows on the All
 * report (team) and each person's report card. The server checks every
 * field again.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Target, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useConfirm } from "@/hooks/use-confirm"

interface Goal { id: string; metric: string; period: "week" | "month"; target: number; user_id: string | null }
interface Metric { key: string; label: string; kind: "count" | "rate" | "wait" }
interface Member { id: string; name: string; role: string }
interface Data { goals: Goal[]; metrics: Metric[]; team: Member[] }

const unit = (kind: Metric["kind"] | undefined) => (kind === "rate" ? "%" : kind === "wait" ? "min" : "")

export function GoalsEditor() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ metric: "won", period: "month" as Goal["period"], target: "", user_id: "" })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const savingRef = useRef(false)
  const loadSeq = useRef(0)
  const confirm = useConfirm()

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const res = await apiFetch("/api/reports/goals", { cache: "no-store" })
      const body = (await res.json()) as Data
      if (seq !== loadSeq.current) return
      setData({ goals: Array.isArray(body?.goals) ? body.goals : [], metrics: Array.isArray(body?.metrics) ? body.metrics : [], team: Array.isArray(body?.team) ? body.team : [] })
      setError(null)
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error("[goals] load failed", err)
      setError(errorText(err, "Could not load the goals."))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const metric = (key: string) => data?.metrics.find((m) => m.key === key)
  const who = (id: string | null) => (id ? data?.team.find((m) => m.id === id)?.name ?? "Former member" : "Whole team")

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await apiFetch("/api/reports/goals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric: form.metric, period: form.period, target: Number(form.target), user_id: form.user_id || null }),
      })
      toast.success("Goal saved.")
      setForm({ ...form, target: "" })
      await load()
    } catch (err) {
      console.error("[goals] add failed", err)
      toast.error(errorText(err, "Could not save the goal."))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function remove(g: Goal) {
    if (busy) return
    if (!(await confirm({ title: "Delete this goal?", description: `${metric(g.metric)?.label ?? g.metric} for ${who(g.user_id)}.`, confirmLabel: "Delete", variant: "destructive" }))) return
    setBusy(g.id)
    try {
      await apiFetch(`/api/reports/goals/${g.id}`, { method: "DELETE" })
      toast.success("Deleted.")
      await load()
    } catch (err) {
      console.error("[goals] delete failed", err)
      toast.error(errorText(err, "Could not delete the goal."))
    } finally {
      setBusy(null)
    }
  }

  const kind = metric(form.metric)?.kind
  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-5">
      <header className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15" aria-hidden><Target className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h1 className="text-balance text-[20px] font-bold leading-tight text-slate-900">Goals</h1>
          <p className="mt-0.5 text-pretty text-[13px] text-slate-600">Progress shows on the All report and on each person&apos;s report card.</p>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-[13px] text-rose-700">{error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div>}

      {data === null && !error ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>
      ) : data && (
        <>
          <section aria-labelledby="goals-list" className="space-y-2">
            <h2 id="goals-list" className="text-[14px] font-semibold text-slate-800">Current goals</h2>
            {data.goals.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-[13px] text-slate-500">No goals yet. Add one below.</p>
            ) : (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
                {data.goals.map((g) => (
                  <li key={g.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[14px] font-semibold text-slate-800">{metric(g.metric)?.label ?? g.metric}: {g.target}{metric(g.metric)?.kind === "wait" ? " min" : unit(metric(g.metric)?.kind)}</p>
                      <p className="text-[12.5px] text-slate-600">This {g.period} · {who(g.user_id)}</p>
                    </div>
                    <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void remove(g)} aria-label={`Delete goal ${metric(g.metric)?.label ?? g.metric} for ${who(g.user_id)}`}>
                      {busy === g.id ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form onSubmit={add} aria-labelledby="goals-add" className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-2">
            <h2 id="goals-add" className="text-[14px] font-semibold text-slate-800 sm:col-span-2">Add a goal</h2>
            <label className="min-w-0 text-[12.5px] font-medium text-slate-600">What
              <select name="metric" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                {data.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-[12.5px] font-medium text-slate-600">When
              <select name="period" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as Goal["period"] })} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                <option value="week">This week</option>
                <option value="month">This month</option>
              </select>
            </label>
            <label className="min-w-0 text-[12.5px] font-medium text-slate-600">Target{unit(kind) ? ` (${unit(kind)})` : ""}
              <input name="target" type="number" inputMode="decimal" min="0" step="any" max={kind === "rate" ? 100 : undefined} required value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} autoComplete="off" className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800" />
            </label>
            <label className="min-w-0 text-[12.5px] font-medium text-slate-600">For
              <select name="user" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                <option value="">Whole team</option>
                {data.team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <p className="text-[12px] text-slate-500 sm:col-span-2">
              {kind === "wait" ? "Met when the middle wait is at or under the target." : kind === "rate" ? "Met when the share reaches the target." : "Compared with the pace the days so far allow."}
            </p>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving || !form.target}>{saving ? <Loader2 className="animate-spin" aria-hidden /> : <Target aria-hidden />}{saving ? "Saving…" : "Save goal"}</Button>
            </div>
          </form>
        </>
      )}
    </div>
  )
}
