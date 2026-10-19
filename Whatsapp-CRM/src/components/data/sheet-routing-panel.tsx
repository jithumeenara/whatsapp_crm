"use client"

/**
 * Sheet routing — Data Store rows sent to the right Google Sheet (and
 * tab) by rules, as they arrive or change, from every source.
 *
 * One slide-over, two views: the rules (with what each delivered, the
 * queue, Preview and "Send existing rows") and the editor for one rule
 * (conditions, destination, split into a tab per group, columns). A rule
 * can be drafted from a sentence by the AI; it is never saved until the
 * person presses Save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Eye, Loader2, Pencil, Plus, RefreshCw, Send, Sparkles, Split, Trash2, Wand2,
} from "lucide-react"
import { toast } from "sonner"
import { SidePanel } from "@/components/data/side-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { GoogleSheetChooser } from "@/components/shared/google-sheet-chooser"
import { GoogleSheetsIcon } from "@/components/shared/google-icons"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { connectGoogle } from "@/lib/google/connect-popup"
import { everyWhileVisible } from "@/lib/visible-interval"
import { cn } from "@/lib/utils"

type Op = "is" | "is_not" | "contains" | "one_of" | "empty" | "not_empty" | "in_month" | "date_between" | "gt" | "lt"
interface Cond { field_key: string; op: Op; value?: string; value2?: string }
interface Field { field_key: string; label: string; field_type: string; options?: unknown }
interface Route {
  id: string
  name: string
  enabled: boolean
  is_fallback: boolean
  match: "all" | "any"
  conditions: Cond[]
  summary: string
  spreadsheet_id: string
  spreadsheet_name: string | null
  url: string
  tab_title: string
  split_template: string | null
  split_into: "tab" | "sheet"
  columns: Array<{ field_key: string; header: string }>
  move_on_edit: boolean
  delivered_count: number
  in_sheet: number
  last_delivered_at: string | null
  last_error: string | null
}
interface State {
  write_access?: boolean
  mode: "first" | "all"
  fields: Field[]
  routes: Route[]
  queue: { pending: number; failed: number; last_error: string | null }
}
interface Preview { total: number; nowhere: number; capped: boolean; destinations: Array<{ rule_id: string; rule: string; place: string; count: number }> }
type Draft = Omit<Route, "id" | "summary" | "url" | "delivered_count" | "in_sheet" | "last_delivered_at" | "last_error"> & { id?: string }

const NOT_ROUTABLE = new Set(["section_header", "html_block", "hidden", "signature", "file", "image", "password", "relation", "address"])
const DATE_TYPES = new Set(["date", "datetime"])
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function opsFor(type: string | undefined): Array<{ value: Op; label: string }> {
  const base: Array<{ value: Op; label: string }> = [
    { value: "is", label: "is" }, { value: "is_not", label: "is not" }, { value: "one_of", label: "is one of" },
    { value: "contains", label: "contains" }, { value: "empty", label: "is empty" }, { value: "not_empty", label: "is not empty" },
  ]
  if (type && DATE_TYPES.has(type)) return [{ value: "in_month", label: "is in month" }, { value: "date_between", label: "is between" }, { value: "gt", label: "is after" }, { value: "lt", label: "is before" }, ...base.slice(4)]
  if (type === "number") return [...base.slice(0, 2), { value: "gt", label: "is more than" }, { value: "lt", label: "is less than" }, ...base.slice(4)]
  return [...base, { value: "in_month", label: "is in month (dates, month names)" }]
}

function choicesOf(f: Field | undefined): string[] {
  if (!f || !Array.isArray(f.options)) return []
  return (f.options as Array<{ label?: unknown; value?: unknown }>).map((o) => String(o?.label ?? o?.value ?? "")).filter(Boolean).slice(0, 40)
}

function ago(iso: string | null): string {
  if (!iso) return ""
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

const emptyDraft = (fallback = false): Draft => ({
  name: fallback ? "Others" : "", enabled: true, is_fallback: fallback, match: "all", conditions: fallback ? [] : [{ field_key: "", op: "is", value: "" }],
  spreadsheet_id: "", spreadsheet_name: null, tab_title: fallback ? "Others" : "Sheet1", split_template: null, split_into: "tab", columns: [], move_on_edit: true,
})

export function SheetRoutingPanel({ tableId, tableName, onClose }: { tableId: string; tableName: string; onClose: () => void }) {
  const [state, setState] = useState<State | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [aiText, setAiText] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<Route | null>(null)
  const [confirmBackfill, setConfirmBackfill] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const res = await apiFetch(`/api/data-tables/${tableId}/sheet-routes`)
      const d = (await res.json()) as State
      if (n === seq.current) { setState(d); setFailed(null) }
    } catch (err) {
      console.error("[sheet-routing] load failed:", err)
      if (n === seq.current) setFailed(errorText(err, "Could not load the routing rules"))
    }
  }, [tableId])

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])
  // The report and the queue, kept fresh while the panel is on screen.
  useEffect(() => everyWhileVisible(() => { if (!draft) void load() }, 15_000), [load, draft])

  async function act(action: string, extra: Record<string, unknown> = {}) {
    const res = await apiFetch(`/api/data-tables/${tableId}/sheet-routes/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }),
    })
    return res.json()
  }

  async function runPreview() {
    if (busy) return
    setBusy("preview")
    try {
      setPreview((await act("preview")) as Preview)
    } catch (err) {
      console.error("[sheet-routing] preview failed:", err)
      toast.error(errorText(err, "Could not preview"))
    } finally {
      setBusy(null)
    }
  }

  async function backfill() {
    setConfirmBackfill(false)
    if (busy) return
    setBusy("backfill")
    try {
      const d = (await act("backfill")) as { queued: number }
      toast.success(`${d.queued} row${d.queued === 1 ? "" : "s"} queued — they reach the sheets over the next minutes.`)
      await load()
    } catch (err) {
      console.error("[sheet-routing] backfill failed:", err)
      toast.error(errorText(err, "Could not send the rows"))
    } finally {
      setBusy(null)
    }
  }

  async function retry() {
    if (busy) return
    setBusy("retry")
    try {
      const d = (await act("retry")) as { retried: number }
      toast.success(`${d.retried} sent again.`)
      await load()
    } catch (err) {
      console.error("[sheet-routing] retry failed:", err)
      toast.error(errorText(err, "Could not retry"))
    } finally {
      setBusy(null)
    }
  }

  async function draftWithAi() {
    if (busy || aiText.trim().length < 4) return
    setBusy("ai")
    try {
      const d = (await act("ai", { text: aiText })) as { draft: { name: string; match: "all" | "any"; conditions: Cond[]; split_template: string | null; tab_title: string | null; dropped: number } }
      setDirty(true)
      setDraft({ ...emptyDraft(), name: d.draft.name, match: d.draft.match, conditions: d.draft.conditions.length ? d.draft.conditions : [{ field_key: "", op: "is", value: "" }], split_template: d.draft.split_template, tab_title: d.draft.tab_title ?? d.draft.name })
      if (d.draft.dropped) toast.message(`${d.draft.dropped} part${d.draft.dropped === 1 ? "" : "s"} of the answer used a field this table does not have — check the conditions.`)
      else toast.success("Drafted — check it, choose the sheet, then Save.")
      setAiText("")
    } catch (err) {
      console.error("[sheet-routing] ai failed:", err)
      toast.error(errorText(err, "The AI could not draft that"))
    } finally {
      setBusy(null)
    }
  }

  async function toggle(r: Route, enabled: boolean) {
    setState((s) => (s ? { ...s, routes: s.routes.map((x) => (x.id === r.id ? { ...x, enabled } : x)) } : s))
    try {
      await apiFetch(`/api/data-tables/${tableId}/sheet-routes/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) })
    } catch (err) {
      console.error("[sheet-routing] toggle failed:", err)
      toast.error(errorText(err, "Could not change the rule"))
    }
    await load()
  }

  async function remove(r: Route) {
    setConfirmDelete(null)
    try {
      await apiFetch(`/api/data-tables/${tableId}/sheet-routes/${r.id}`, { method: "DELETE" })
      toast.success("Rule removed. Rows already in the sheet stay there.")
    } catch (err) {
      console.error("[sheet-routing] delete failed:", err)
      toast.error(errorText(err, "Could not remove the rule"))
    }
    await load()
  }

  async function move(i: number, d: -1 | 1) {
    if (!state) return
    const list = state.routes.filter((r) => !r.is_fallback)
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    setState({ ...state, routes: [...next, ...state.routes.filter((r) => r.is_fallback)] })
    try {
      await apiFetch(`/api/data-tables/${tableId}/sheet-routes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: next.map((r) => r.id) }) })
    } catch (err) {
      console.error("[sheet-routing] reorder failed:", err)
      toast.error(errorText(err, "Could not reorder"))
      await load()
    }
  }

  async function setMode(mode: "first" | "all") {
    if (!state) return
    setState({ ...state, mode })
    try {
      await apiFetch(`/api/data-tables/${tableId}/sheet-routes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) })
      setPreview(null)
    } catch (err) {
      console.error("[sheet-routing] mode failed:", err)
      toast.error(errorText(err, "Could not save"))
      await load()
    }
  }

  if (draft && state) {
    const leave = async (saved: boolean) => {
      // A drafted rule is never dropped without asking.
      if (!saved && dirty && !window.confirm("Leave without saving this rule?")) return
      setDraft(null)
      setDirty(false)
      setPreview(null)
      await load()
    }
    return (
      <SidePanel title={draft.id ? "Edit rule" : draft.is_fallback ? "“Others” rule" : "New rule"} subtitle={tableName} icon={<Split className="h-5 w-5" />} onClose={() => void leave(false)}>
        <RuleEditor tableId={tableId} fields={state.fields} draft={draft} onChange={(d) => { setDirty(true); setDraft(d) }}
          onDone={(saved) => leave(saved)} />
      </SidePanel>
    )
  }

  const rules = state?.routes.filter((r) => !r.is_fallback) ?? []
  const fallback = state?.routes.find((r) => r.is_fallback) ?? null

  return (
    <SidePanel title="Sheet routing" subtitle={tableName} icon={<Split className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-5">
        {failed && <p className="rounded-xl bg-rose-50 p-3 text-[12.5px] text-rose-700">{failed}</p>}
        {!state && !failed && <div className="h-40 animate-pulse rounded-2xl bg-slate-50" />}

        {state && (
          <>
            {state.write_access === false && (
              <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900" role="status">
                <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Google has not allowed the CRM to edit your sheets yet, so rows cannot be written to a sheet you chose from your Drive. Allow it once:</p>
                <Button type="button" size="sm" onClick={() => connectGoogle(`/api/google/connect?services=sheets_sync&return=${encodeURIComponent(`/data/${tableId}`)}`, (r) => {
                  if (r.outcome === "error") toast.error(r.reason || "Google was not connected.")
                  if (r.outcome !== "closed") void load()
                })}>Allow editing Google Sheets</Button>
              </div>
            )}

            <p className="text-[12.5px] leading-relaxed text-slate-600">
              Each new or changed row goes to the Google Sheet its rule says — from forms, chatbots, the AI, imports, payments, or by hand. If a row changes so it fits another rule, it moves there.
            </p>

            {/* AI draft */}
            <form className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3" onSubmit={(e) => { e.preventDefault(); void draftWithAi() }}>
              <label htmlFor="route-ai" className="flex items-center gap-1.5 text-[12px] font-medium text-indigo-900"><Sparkles className="h-3.5 w-3.5" aria-hidden /> Describe a rule in words</label>
              <textarea id="route-ai" value={aiText} onChange={(e) => setAiText(e.target.value)} rows={2} maxLength={500}
                placeholder="e.g. Supervisory Staff registrations for October go to a tab called Oct – Supervisory"
                className="w-full resize-none rounded-lg border border-indigo-100 bg-white px-2.5 py-2 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <Button type="submit" size="sm" disabled={busy === "ai" || aiText.trim().length < 4}>
                {busy === "ai" ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />} Draft the rule
              </Button>
            </form>

            {rules.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-[11.5px] font-medium text-slate-600">A row that fits more than one rule goes to</p>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Rows that fit more than one rule">
                  {([["first", "The first rule only"], ["all", "Every matching rule"]] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={state.mode === v} onClick={() => void setMode(v)}
                      className={cn("rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors", state.mode === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {rules.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center">
                  <GoogleSheetsIcon className="mx-auto h-8 w-8" />
                  <p className="mt-2 text-[13px] font-semibold text-slate-800">No rules yet</p>
                  <p className="mt-1 text-[12px] text-slate-500">For example: rows where “Target group” is “Supervisory Staff” and the date is in October → the “Oct – Supervisory” tab.</p>
                </div>
              )}
              {rules.map((r, i) => (
                <RuleCard key={r.id} r={r} index={i} count={rules.length} onToggle={(v) => void toggle(r, v)} onEdit={() => setDraft({ ...r })}
                  onDelete={() => setConfirmDelete(r)} onMove={(d) => void move(i, d)} />
              ))}
              <Button type="button" variant="outline" className="w-full" onClick={() => setDraft(emptyDraft())}><Plus aria-hidden /> Add rule</Button>
            </div>

            <div className="space-y-2">
              <p className="text-[11.5px] font-medium text-slate-600">Rows no rule takes</p>
              {fallback ? (
                <RuleCard r={fallback} index={0} count={1} onToggle={(v) => void toggle(fallback, v)} onEdit={() => setDraft({ ...fallback })} onDelete={() => setConfirmDelete(fallback)} />
              ) : (
                <button type="button" onClick={() => setDraft(emptyDraft(true))}
                  className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-left text-[12px] text-slate-500 hover:border-slate-400 hover:text-slate-700">
                  Stay only in the table. <span className="font-medium text-indigo-600">Add an “Others” sheet</span> so none are missed.
                </button>
              )}
            </div>

            {(state.queue.pending > 0 || state.queue.failed > 0) && (
              <div className={cn("flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12px]", state.queue.failed ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-600")} aria-live="polite">
                {state.queue.failed ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p>
                    {state.queue.pending > 0 && <span className="tabular-nums">{state.queue.pending} on the way</span>}
                    {state.queue.pending > 0 && state.queue.failed > 0 && " · "}
                    {state.queue.failed > 0 && <span className="tabular-nums">{state.queue.failed} could not be sent</span>}
                  </p>
                  {state.queue.failed > 0 && state.queue.last_error && <p className="mt-0.5 break-words text-[11.5px] opacity-80">{state.queue.last_error}</p>}
                </div>
                {state.queue.failed > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => void retry()} disabled={busy === "retry"}>
                    {busy === "retry" ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Retry
                  </Button>
                )}
              </div>
            )}

            {state.routes.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void runPreview()} disabled={!!busy}>
                    {busy === "preview" ? <Loader2 className="animate-spin" aria-hidden /> : <Eye aria-hidden />} Preview
                  </Button>
                  <Button type="button" size="sm" onClick={() => setConfirmBackfill(true)} disabled={!!busy}>
                    {busy === "backfill" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Send existing rows
                  </Button>
                </div>
                <p className="text-[11px] text-slate-500">New and changed rows are sent on their own. “Send existing rows” is for rows that were here before the rules.</p>
                {preview && <PreviewTable p={preview} />}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Remove “${confirmDelete?.name ?? ""}”?`}
        description="New rows stop going to its sheet. Rows already there stay — nothing is deleted from Google Sheets."
        confirmLabel="Remove rule"
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete) }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={confirmBackfill}
        title="Send every existing row?"
        description="Each row goes to the sheet its rule says. Rows already there are updated, never added twice. Large tables take a few minutes — Google allows about 60 changes a minute."
        confirmLabel="Send rows"
        variant="default"
        onConfirm={() => void backfill()}
        onCancel={() => setConfirmBackfill(false)}
      />
    </SidePanel>
  )
}

function RuleCard({ r, index, count, onToggle, onEdit, onDelete, onMove }: {
  r: Route; index: number; count: number; onToggle: (v: boolean) => void; onEdit: () => void; onDelete: () => void; onMove?: (d: -1 | 1) => void
}) {
  const place = r.split_template
    ? `${r.split_into === "sheet" ? "a sheet" : "a tab"} per ${r.split_template.replace(/\{\{\s*([^}|]+?)\s*(\|[a-z]+)?\s*\}\}/gi, "$1")}`
    : `“${r.tab_title}”`
  return (
    <div className={cn("rounded-2xl border bg-white p-3 transition-colors", r.enabled ? "border-slate-200" : "border-slate-200 opacity-60")}>
      <div className="flex items-start gap-2">
        <Switch checked={r.enabled} onCheckedChange={(v) => onToggle(Boolean(v))} aria-label={`${r.name}: on or off`} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-800">{r.name}</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{r.is_fallback ? "Rows no other rule takes" : `When ${r.summary}`}</p>
          <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-[11.5px] font-medium text-emerald-700 hover:underline">
            <GoogleSheetsIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{r.spreadsheet_name || "Google Sheet"} › {place}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        </div>
        <button type="button" onClick={onEdit} aria-label={`Edit ${r.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" aria-hidden /></button>
      </div>
      <div className="mt-2 flex items-center gap-x-3 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        <span className="tabular-nums"><span className="font-semibold text-slate-700">{r.in_sheet}</span> in sheet</span>
        <span className="tabular-nums">{r.delivered_count} added</span>
        {r.last_delivered_at && <span className="hidden min-[380px]:inline">last {ago(r.last_delivered_at)}</span>}
        <span className="ml-auto flex items-center">
          {onMove && count > 1 && (
            <>
              <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${r.name} up`} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden /></button>
              <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${r.name} down`} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden /></button>
            </>
          )}
          <button type="button" onClick={onDelete} aria-label={`Remove ${r.name}`} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
        </span>
      </div>
      {r.last_error && <p className="mt-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">{r.last_error}</p>}
    </div>
  )
}

function PreviewTable({ p }: { p: Preview }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-slate-200 p-3" aria-live="polite">
      <p className="text-[12px] font-medium text-slate-700">
        <span className="tabular-nums">{p.total}</span> row{p.total === 1 ? "" : "s"}{p.capped ? " (the newest 5,000)" : ""} would go to:
      </p>
      {p.destinations.length === 0 ? (
        <p className="text-[12px] text-slate-500">No rule matches any row yet.</p>
      ) : (
        <ul className="space-y-1">
          {p.destinations.map((d) => (
            <li key={`${d.rule_id}-${d.place}`} className="flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate text-slate-700">{d.rule} <span className="text-slate-400">›</span> {d.place}</span>
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold tabular-nums text-emerald-800">{d.count}</span>
            </li>
          ))}
        </ul>
      )}
      {p.nowhere > 0 && <p className="text-[11.5px] text-amber-800"><span className="tabular-nums">{p.nowhere}</span> fit no rule and stay only in the table.</p>}
    </div>
  )
}

/** One rule: conditions, where to, split, columns. */
function RuleEditor({ tableId, fields, draft, onChange, onDone }: {
  tableId: string
  fields: Field[]
  draft: Draft
  onChange: (d: Draft) => void
  onDone: (saved: boolean) => Promise<void>
}) {
  const usable = useMemo(() => fields.filter((f) => !NOT_ROUTABLE.has(f.field_type)), [fields])
  const byKey = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields])
  const [choosing, setChoosing] = useState(false)
  const [tabs, setTabs] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [count, setCount] = useState<Preview | null>(null)
  const [creating, setCreating] = useState(false)
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  const conds = draft.conditions

  // The chosen sheet's tabs, for the tab picker.
  useEffect(() => {
    if (!draft.spreadsheet_id) return
    let live = true
    apiFetch(`/api/google/sheets/preview?picked=1&spreadsheet=${encodeURIComponent(draft.spreadsheet_id)}`)
      .then((r) => r.json())
      .then((d: { tabs?: Array<{ title: string }>; title?: string }) => {
        if (!live) return
        setTabs((d.tabs ?? []).map((t) => t.title))
      })
      .catch((err) => console.error("[sheet-routing] tabs failed:", err))
    return () => { live = false }
  }, [draft.spreadsheet_id])

  // How many rows this rule takes, as it is edited (debounced; newest answer wins).
  const seq = useRef(0)
  const key = JSON.stringify([draft.conditions, draft.match, draft.split_template, draft.split_into, draft.tab_title, draft.is_fallback])
  useEffect(() => {
    if (draft.is_fallback) return
    const n = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/data-tables/${tableId}/sheet-routes/actions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", rule: draft }),
        })
        const d = (await res.json()) as Preview
        if (n === seq.current) setCount(d)
      } catch (err) {
        console.error("[sheet-routing] count failed:", err)
      }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tableId])

  function condAt(i: number, patch: Partial<Cond>) {
    set({ conditions: conds.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  }

  async function createSheet() {
    if (creating) return
    setCreating(true)
    try {
      const res = await apiFetch("/api/google/sheets/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.name || "Routed rows", tab: draft.split_template ? "Sheet1" : draft.tab_title || "Sheet1" }),
      })
      const d = (await res.json()) as { id?: string; name?: string; tab?: string; needs_write?: boolean }
      if (d.needs_write) {
        connectGoogle(`/api/google/connect?services=sheets_sync&return=${encodeURIComponent(`/data/${tableId}`)}`, (r) => {
          if (r.outcome === "connected") toast.success("Google Sheets allowed — press Create again.")
          else if (r.outcome === "error") toast.error(r.reason || "Google was not connected.")
        })
        return
      }
      if (!d.id) throw new Error("Google did not return the new sheet.")
      set({ spreadsheet_id: d.id, spreadsheet_name: d.name ?? null })
      toast.success(`“${d.name}” created in your Google Drive`)
    } catch (err) {
      console.error("[sheet-routing] create failed:", err)
      toast.error(errorText(err, "Could not create the sheet"))
    } finally {
      setCreating(false)
    }
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const body = JSON.stringify({ ...draft, conditions: draft.conditions.filter((c) => c.field_key) })
      if (draft.id) await apiFetch(`/api/data-tables/${tableId}/sheet-routes/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
      else await apiFetch(`/api/data-tables/${tableId}/sheet-routes`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      toast.success(draft.id ? "Rule saved" : "Rule added — new and changed rows follow it from now on.")
      await onDone(true)
    } catch (err) {
      console.error("[sheet-routing] save failed:", err)
      toast.error(errorText(err, "Could not save the rule"))
    } finally {
      setSaving(false)
    }
  }

  const tokenFields = usable.slice(0, 12)
  const allColumns = draft.columns.length === 0

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => void onDone(false)} className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All rules
      </button>

      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-slate-700">Rule name</span>
        <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} autoComplete="off" placeholder="e.g. Supervisory Staff – October" />
      </label>

      {!draft.is_fallback && (
        <section className="space-y-2">
          <h3 className="text-[12px] font-medium text-slate-700">When</h3>
          {conds.filter((c) => c.field_key).length > 1 && (
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="How conditions combine">
              {([["all", "All of these"], ["any", "Any of these"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={draft.match === v} onClick={() => set({ match: v })}
                  className={cn("rounded-lg px-2 py-1.5 text-[12px] font-medium", draft.match === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{label}</button>
              ))}
            </div>
          )}
          {conds.map((c, i) => {
            const f = byKey.get(c.field_key)
            const ops = opsFor(c.field_key === "__created" ? "date" : f?.field_type)
            const choices = choicesOf(f)
            const needsValue = c.op !== "empty" && c.op !== "not_empty"
            return (
              <div key={i} className="space-y-1.5 rounded-xl border border-slate-200 p-2.5">
                {i > 0 && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{draft.match === "any" ? "or" : "and"}</span>}
                <div className="flex items-center gap-1.5">
                  <Select value={c.field_key || null} onValueChange={(v) => {
                    const k = String(v ?? "")
                    const t = k === "__created" ? "date" : byKey.get(k)?.field_type
                    condAt(i, { field_key: k, op: t && DATE_TYPES.has(t) ? "in_month" : "is", value: "", value2: undefined })
                  }}>
                    <SelectTrigger className="h-9 min-w-0 flex-1 text-[12.5px]" aria-label={`Condition ${i + 1} field`}><SelectValue placeholder="Field…" /></SelectTrigger>
                    <SelectContent>
                      {usable.map((x) => <SelectItem key={x.field_key} value={x.field_key}>{x.label}</SelectItem>)}
                      <SelectItem value="__created">Date added</SelectItem>
                    </SelectContent>
                  </Select>
                  <button type="button" onClick={() => set({ conditions: conds.filter((_, j) => j !== i) })} aria-label={`Remove condition ${i + 1}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                </div>
                {c.field_key && (
                  <Select value={c.op} onValueChange={(v) => condAt(i, { op: String(v ?? "is") as Op })}>
                    <SelectTrigger className="h-9 w-full text-[12.5px]" aria-label={`Condition ${i + 1} comparison`}><SelectValue /></SelectTrigger>
                    <SelectContent>{ops.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {c.field_key && needsValue && c.op === "in_month" && (
                  <div className="flex flex-wrap gap-1">
                    {[["this_month", "This month"], ["last_month", "Last month"], ["next_month", "Next month"], ...MONTHS.map((m) => [m, m.slice(0, 3)])].map(([v, label]) => (
                      <button key={v} type="button" onClick={() => condAt(i, { value: v })}
                        className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", c.value === v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-200")}>{label}</button>
                    ))}
                  </div>
                )}
                {c.field_key && needsValue && c.op === "date_between" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input type="date" className="h-9 text-[12.5px]" value={c.value ?? ""} onChange={(e) => condAt(i, { value: e.target.value })} aria-label="From" />
                    <Input type="date" className="h-9 text-[12.5px]" value={c.value2 ?? ""} onChange={(e) => condAt(i, { value2: e.target.value })} aria-label="To" />
                  </div>
                )}
                {c.field_key && needsValue && c.op !== "in_month" && c.op !== "date_between" && (
                  <>
                    <Input className="h-9 text-[12.5px]" value={c.value ?? ""} autoComplete="off" aria-label={`Condition ${i + 1} value`}
                      type={(c.op === "gt" || c.op === "lt") && f && DATE_TYPES.has(f.field_type) ? "date" : "text"}
                      placeholder={c.op === "one_of" ? "Values separated by commas" : "Value"} onChange={(e) => condAt(i, { value: e.target.value })} />
                    {choices.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {choices.map((ch) => {
                          const on = c.op === "one_of" ? (c.value ?? "").split(",").map((s) => s.trim()).includes(ch) : c.value === ch
                          return (
                            <button key={ch} type="button" onClick={() => {
                              if (c.op !== "one_of") return condAt(i, { value: ch })
                              const list = (c.value ?? "").split(",").map((s) => s.trim()).filter(Boolean)
                              condAt(i, { value: (on ? list.filter((x) => x !== ch) : [...list, ch]).join(", ") })
                            }}
                              className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-200")}>{ch}</button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
          {conds.length < 10 && (
            <button type="button" onClick={() => set({ conditions: [...conds, { field_key: "", op: "is", value: "" }] })}
              className="flex items-center gap-1 text-[12px] font-medium text-indigo-600 hover:underline"><Plus className="h-3.5 w-3.5" aria-hidden /> Add condition</button>
          )}
          {conds.filter((c) => c.field_key).length === 0 && <p className="text-[11.5px] text-amber-800">No condition: every row goes to this sheet.</p>}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-slate-700">Send to</h3>
        {draft.spreadsheet_id ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
            <GoogleSheetsIcon className="h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-800">{draft.spreadsheet_name || "Google Sheet"}</span>
            <button type="button" onClick={() => setChoosing(true)} className="text-[12px] font-medium text-indigo-600 hover:underline">Change</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setChoosing(true)}><GoogleSheetsIcon className="h-4 w-4" /> Choose sheet</Button>
            <Button type="button" variant="outline" onClick={() => void createSheet()} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Create new
            </Button>
          </div>
        )}

        <label className="flex items-start gap-2 pt-1">
          <Switch checked={!!draft.split_template} onCheckedChange={(v) => set({ split_template: v ? (() => { const choice = usable.find((f) => ["select", "radio"].includes(f.field_type)); return choice ? `{{${choice.label}}}` : "{{Created|month}}" })() : null })} aria-label="One tab per group" className="mt-0.5" />
          <span className="text-[12.5px] text-slate-700">
            A separate tab for each group
            <span className="block text-[11px] text-slate-500">e.g. one tab per month and target group — made the first time a row needs it.</span>
          </span>
        </label>

        {draft.split_template !== null ? (
          <div className="space-y-2 rounded-xl bg-slate-50 p-2.5">
            <Input value={draft.split_template ?? ""} onChange={(e) => set({ split_template: e.target.value })} maxLength={200} autoComplete="off" aria-label="Group name" className="h-9 font-mono text-[12px]" />
            <div className="flex flex-wrap gap-1">
              {tokenFields.map((f) => (
                <button key={f.field_key} type="button" onClick={() => set({ split_template: `${draft.split_template ?? ""}${draft.split_template ? " – " : ""}{{${f.label}${DATE_TYPES.has(f.field_type) ? "|month" : ""}}}` })}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-indigo-200">+ {f.label}{DATE_TYPES.has(f.field_type) ? " (month)" : ""}</button>
              ))}
              <button type="button" onClick={() => set({ split_template: `${draft.split_template ?? ""}${draft.split_template ? " – " : ""}{{Created|month}}` })}
                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-indigo-200">+ Month added</button>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white p-1" role="radiogroup" aria-label="Split into">
              {([["tab", "Tabs in this sheet"], ["sheet", "Separate sheets"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={draft.split_into === v} onClick={() => set({ split_into: v })}
                  className={cn("rounded-md px-2 py-1 text-[11.5px] font-medium", draft.split_into === v ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:text-slate-800")}>{label}</button>
              ))}
            </div>
          </div>
        ) : (
          <label className="block space-y-1">
            <span className="text-[11.5px] text-slate-600">Tab</span>
            <Input value={draft.tab_title} onChange={(e) => set({ tab_title: e.target.value })} maxLength={100} list={`tabs-${tableId}`} autoComplete="off" className="h-9 text-[12.5px]" />
            <datalist id={`tabs-${tableId}`}>{tabs.map((t) => <option key={t} value={t} />)}</datalist>
            <span className="block text-[11px] text-slate-500">{tabs.some((t) => t.toLowerCase() === draft.tab_title.trim().toLowerCase()) ? "An existing tab." : "A new tab — made with its header row."}</span>
          </label>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-medium text-slate-700">Columns</h3>
          <button type="button" onClick={() => set({ columns: allColumns ? usable.map((f) => ({ field_key: f.field_key, header: f.label })) : [] })}
            className="text-[11.5px] font-medium text-indigo-600 hover:underline">{allColumns ? "Choose columns" : "Use every field"}</button>
        </div>
        {allColumns ? (
          <p className="text-[11.5px] text-slate-500">Every field, in the table’s order, plus a “CRM ID” column the CRM uses to find the row again.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {draft.columns.map((c, i) => (
              <li key={c.field_key} className="flex items-center gap-1.5 px-2 py-1.5">
                <Input value={c.header} onChange={(e) => set({ columns: draft.columns.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)) })}
                  className="h-8 min-w-0 flex-1 text-[12px]" aria-label={`Header for ${byKey.get(c.field_key)?.label ?? c.field_key}`} maxLength={100} />
                <button type="button" disabled={i === 0} onClick={() => { const n = [...draft.columns]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set({ columns: n }) }} aria-label="Move up" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden /></button>
                <button type="button" disabled={i === draft.columns.length - 1} onClick={() => { const n = [...draft.columns]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set({ columns: n }) }} aria-label="Move down" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden /></button>
                <button type="button" onClick={() => set({ columns: draft.columns.filter((_, j) => j !== i) })} aria-label="Leave this column out" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </li>
            ))}
            {usable.filter((f) => !draft.columns.some((c) => c.field_key === f.field_key)).length > 0 && (
              <li className="flex flex-wrap gap-1 px-2 py-2">
                {usable.filter((f) => !draft.columns.some((c) => c.field_key === f.field_key)).map((f) => (
                  <button key={f.field_key} type="button" onClick={() => set({ columns: [...draft.columns, { field_key: f.field_key, header: f.label }] })}
                    className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-indigo-300">+ {f.label}</button>
                ))}
              </li>
            )}
          </ul>
        )}
      </section>

      <label className="flex items-start gap-2">
        <Switch checked={draft.move_on_edit} onCheckedChange={(v) => set({ move_on_edit: Boolean(v) })} aria-label="Keep the sheet in step" className="mt-0.5" />
        <span className="text-[12.5px] text-slate-700">
          Keep the sheet in step
          <span className="block text-[11px] text-slate-500">A row that is edited so it no longer fits — or is deleted — is taken out of this sheet (and moved to the one it now fits).</span>
        </span>
      </label>

      {!draft.is_fallback && count && (
        <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900" aria-live="polite">
          {count.destinations.reduce((n, d) => n + d.count, 0) === 0
            ? `No row of the ${count.total} in the table fits yet.`
            : `${count.destinations.reduce((n, d) => n + d.count, 0)} of ${count.total} rows fit this rule${count.destinations.length > 1 ? `: ${count.destinations.slice(0, 4).map((d) => `${d.place.replace(/^Tab /, "")} (${d.count})`).join(", ")}${count.destinations.length > 4 ? "…" : ""}` : "."}`}
        </div>
      )}

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <Button type="button" onClick={() => void save()} disabled={saving || !draft.name.trim() || !draft.spreadsheet_id}>
          {saving && <Loader2 className="animate-spin" aria-hidden />} Save rule
        </Button>
        <Button type="button" variant="ghost" onClick={() => void onDone(false)}>Cancel</Button>
      </div>
      {!draft.spreadsheet_id && <p className="-mt-3 text-[11px] text-slate-500">Choose or create the sheet to save.</p>}

      {choosing && (
        <GoogleSheetChooser
          subtitle="Rows that fit this rule go here"
          returnTo={`/data/${tableId}`}
          onClose={() => setChoosing(false)}
          onChosen={(s) => { setChoosing(false); set({ spreadsheet_id: s.id, spreadsheet_name: s.name }) }}
        />
      )}
    </div>
  )
}
