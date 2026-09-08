"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Workflow, Plus, Pencil, Trash2, Play, Pause, Eye, RefreshCw, CheckCircle2, AlertTriangle, Loader2, Clock } from "lucide-react"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"

interface Flow { id: string; name: string; is_active: boolean; trigger_type: string; execution_count: number; created_at: string; last_executed_at?: string | null }

interface LastErrorData { reason: string | null; at: string }
type LastError = LastErrorData | null

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const TRIGGER_LABEL: Record<string, string> = {
  keyword: "Keyword", first_message: "First message", manual: "Manual",
}

function relativeTime(iso?: string | null) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function FlowsV2() {
  const [flows, setFlows] = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [lastErrors, setLastErrors] = useState<Record<string, LastError | "loading">>({})

  async function load() {
    setLoading(true)
    try {
      const data = await fetch("/api/flows").then((r) => r.json())
      setFlows(Array.isArray(data) ? data : (data?.flows ?? []))
    } catch { toast.error("Failed") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function sync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/flows/sync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Sync failed"); return }
      toast.success(`Synced — ${data.inserted ?? 0} new, ${data.updated ?? 0} updated`)
      load()
    } catch { toast.error("Failed to sync") }
    finally { setSyncing(false) }
  }

  async function toggle(id: string, active: boolean) {
    try {
      await fetch(`/api/flows/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: active }) })
      setFlows((prev) => prev.map((f) => f.id === id ? { ...f, is_active: active } : f))
      toast.success(active ? "Flow activated" : "Flow paused")
    } catch { toast.error("Failed") }
  }

  async function del(id: string) {
    try {
      await fetch(`/api/flows/${id}`, { method: "DELETE" })
      toast.success("Deleted"); setDeleteId(null); load()
    } catch { toast.error("Failed") }
  }

  function onRowOpenChange(flowId: string, open: boolean) {
    if (!open || lastErrors[flowId] !== undefined) return
    setLastErrors((prev) => ({ ...prev, [flowId]: "loading" }))
    fetch(`/api/flows/${flowId}/last-error`)
      .then((r) => r.json())
      .then((d) => setLastErrors((prev) => ({ ...prev, [flowId]: d.last_error ?? null })))
      .catch(() => setLastErrors((prev) => ({ ...prev, [flowId]: null })))
  }

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
              <Workflow className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">Flows</h1>
              <p className="text-[11px] text-slate-500">{flows.length} flow{flows.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={sync} disabled={syncing} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} /> Sync from Meta
            </button>
            <Link href="/flows/new" className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Flow
            </Link>
          </div>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 p-5 h-[100px] animate-pulse" />)}
          </div>
        ) : flows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4"><Workflow className="h-7 w-7 text-slate-400" /></div>
            <p className="text-[14px] font-semibold text-slate-700">No flows yet</p>
            <p className="mt-1 text-[12px] text-slate-400">Build WhatsApp interactive flows</p>
            <Link href="/flows/new" className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Flow
            </Link>
          </div>
        ) : (
          <Accordion multiple className="space-y-3">
            {flows.map((flow) => {
              const lastError = lastErrors[flow.id]
              return (
                <AccordionItem
                  key={flow.id}
                  value={flow.id}
                  onOpenChange={(open) => onRowOpenChange(flow.id, open)}
                  className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden"
                >
                  <div className="flex items-center gap-4 p-4">
                    <button type="button" onClick={() => toggle(flow.id, !flow.is_active)} className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors", flow.is_active ? "bg-emerald-50 hover:bg-emerald-100" : "bg-slate-100 hover:bg-slate-200")}>
                      {flow.is_active ? <Play className="h-4 w-4 text-emerald-600" /> : <Pause className="h-4 w-4 text-slate-400" />}
                    </button>
                    <AccordionTrigger className="min-w-0 flex-1 rounded-lg border-none p-0 text-left hover:no-underline hover:bg-transparent focus-visible:ring-0 focus-visible:after:border-none">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-semibold text-slate-900 truncate">{flow.name}</p>
                          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", flow.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-slate-100 text-slate-500 border-slate-200")}>
                            {flow.is_active ? "Active" : "Paused"}
                          </span>
                        </div>
                        <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
                          <span>Trigger: <span className="font-medium text-slate-700">{TRIGGER_LABEL[flow.trigger_type] ?? flow.trigger_type}</span></span>
                          <span>{flow.execution_count} runs</span>
                          {flow.last_executed_at && <span>Last: {relativeTime(flow.last_executed_at)}</span>}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <div className="flex shrink-0 gap-1">
                      <Link href={`/flows/${flow.id}`} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></Link>
                      <Link href={`/flows/${flow.id}/runs`} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="View runs"><Eye className="h-3.5 w-3.5" /></Link>
                      <button type="button" onClick={() => setDeleteId(flow.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <AccordionContent className="px-4">
                    <div className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-slate-400">Last run</p>
                          <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        </div>
                        <p className="mt-1 text-[13px] font-semibold text-slate-700">
                          {flow.last_executed_at ? relativeTime(flow.last_executed_at) : "Never run yet"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] text-slate-400">Last error</p>
                          {lastError === "loading" ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
                          ) : lastError ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          )}
                        </div>
                        <p className={cn("mt-1 text-[13px] font-semibold", lastError ? "text-amber-600" : "text-emerald-600")}>
                          {lastError === "loading" ? "Checking…" : lastError ? (lastError.reason ?? "Failed") : "No errors"}
                        </p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}
      </div>

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[15px] font-semibold text-slate-900 mb-2">Delete Flow?</h2>
            <p className="text-[13px] text-slate-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteId(null)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600">Cancel</button>
              <button type="button" onClick={() => del(deleteId)} className="flex-1 rounded-lg bg-rose-600 py-2 text-[13px] font-medium text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
