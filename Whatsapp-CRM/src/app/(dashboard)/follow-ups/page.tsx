"use client"

import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import {
  CalendarCheck, Plus, CheckCircle2, SkipForward, Clock,
  AlertTriangle, ChevronDown, ChevronUp, MoreHorizontal, X,
} from "lucide-react"

function FollowUpFormDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; onSave: () => void }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: "", note: "", due_at: "" })
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    try {
      const res = await fetch("/api/follow-ups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Failed")
      toast.success("Follow-up scheduled")
      onOpenChange(false); onSave(); setForm({ title: "", note: "", due_at: "" })
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed") }
    finally { setSaving(false) }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-[15px] font-semibold text-slate-900 mb-4">Schedule Follow-up</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1">Title</label>
            <input required placeholder="e.g. Follow up on proposal" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1">Due Date & Time</label>
            <input type="datetime-local" required value={form.due_at} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1">Notes (optional)</label>
            <textarea rows={2} placeholder="Any notes…" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] resize-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-indigo-600 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? "Saving…" : "Schedule"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

interface FollowUp {
  id: string
  title: string
  due_at: string
  status: "pending" | "done" | "skipped"
  notes?: string | null
  contact?: { name?: string | null; phone: string } | null
  assigned_to_user?: { profile?: { full_name: string } | null } | null
  lead?: { title: string } | null
}

type FilterStatus = "pending" | "done" | "skipped" | "all"

function isOverdue(due: string, status: string) {
  return status === "pending" && new Date(due) < new Date()
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff === -1) return "Yesterday"
  return d.toLocaleDateString("en", { month: "short", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined })
}

function StatusBadge({ status, due_at }: { status: string; due_at: string }) {
  if (isOverdue(due_at, status)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
        <AlertTriangle className="h-2.5 w-2.5" /> Overdue
      </span>
    )
  }
  if (status === "done") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><CheckCircle2 className="h-2.5 w-2.5" /> Done</span>
  }
  if (status === "skipped") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500"><SkipForward className="h-2.5 w-2.5" /> Skipped</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"><Clock className="h-2.5 w-2.5" /> Pending</span>
}

export default function FollowUpsV2() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pending")
  const [createOpen, setCreateOpen] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus !== "all") params.set("status", filterStatus)
      const data = await fetch(`/api/follow-ups?${params}`).then((r) => r.json())
      setFollowUps(Array.isArray(data) ? data : (data?.followUps ?? []))
    } catch {
      toast.error("Failed to load follow-ups")
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => { load() }, [load])

  async function updateStatus(id: string, status: "done" | "skipped") {
    try {
      await fetch(`/api/follow-ups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      toast.success(status === "done" ? "Marked as done!" : "Skipped")
      load()
    } catch {
      toast.error("Failed to update")
    }
  }

  async function deleteFollowUp(id: string) {
    try {
      await fetch(`/api/follow-ups/${id}`, { method: "DELETE" })
      toast.success("Deleted")
      load()
    } catch {
      toast.error("Failed to delete")
    }
  }

  const overdue = followUps.filter((f) => isOverdue(f.due_at, f.status))

  const FILTERS: { key: FilterStatus; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "done",    label: "Done" },
    { key: "skipped", label: "Skipped" },
    { key: "all",     label: "All" },
  ]

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
              <CalendarCheck className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">Follow-ups</h1>
              <p className="text-[11px] text-slate-500">{loading ? "Loading…" : `${followUps.length} item${followUps.length !== 1 ? "s" : ""}`}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> New Follow-up
          </button>
        </div>

        {/* Filter tabs */}
        <div className="mt-3 flex gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilterStatus(f.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                filterStatus === f.key
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overdue alert */}
      {filterStatus !== "done" && filterStatus !== "skipped" && overdue.length > 0 && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <p className="text-[13px] text-rose-700 font-medium">
            {overdue.length} overdue follow-up{overdue.length !== 1 ? "s" : ""} need your attention
          </p>
        </div>
      )}

      {/* List */}
      <div className="p-6 space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 p-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-slate-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-slate-100" />
                  <div className="h-3 w-1/2 rounded bg-slate-100" />
                </div>
              </div>
            </div>
          ))
        ) : followUps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
              <CalendarCheck className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700">No follow-ups</p>
            <p className="mt-1 text-[12px] text-slate-400">Schedule your first follow-up to stay on top of leads</p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> New Follow-up
            </button>
          </div>
        ) : (
          followUps.map((fu) => {
            const overdueFu = isOverdue(fu.due_at, fu.status)
            return (
              <div
                key={fu.id}
                className={cn(
                  "bg-white rounded-xl border p-4 transition-shadow",
                  overdueFu
                    ? "border-rose-200 bg-rose-50/30"
                    : "border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    fu.status === "done" ? "bg-emerald-100" : overdueFu ? "bg-rose-100" : "bg-amber-50",
                  )}>
                    {fu.status === "done"
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      : fu.status === "skipped"
                      ? <SkipForward className="h-4 w-4 text-slate-400" />
                      : overdueFu
                      ? <AlertTriangle className="h-4 w-4 text-rose-600" />
                      : <Clock className="h-4 w-4 text-amber-600" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-[14px] font-semibold", fu.status === "done" ? "text-slate-400 line-through" : "text-slate-900")}>
                        {fu.title}
                      </p>
                      <StatusBadge status={fu.status} due_at={fu.due_at} />
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={cn("text-[12px] font-medium", overdueFu ? "text-rose-600" : "text-slate-500")}>
                        {fmtDate(fu.due_at)} · {new Date(fu.due_at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {fu.contact && (
                        <span className="text-[12px] text-slate-500">
                          {fu.contact.name ?? fu.contact.phone}
                        </span>
                      )}
                      {fu.lead && (
                        <span className="text-[12px] text-slate-400">{fu.lead.title}</span>
                      )}
                    </div>

                    {fu.notes && (
                      <p className="mt-1.5 text-[12px] text-slate-500 italic">{fu.notes}</p>
                    )}
                  </div>

                  {/* Actions */}
                  {fu.status === "pending" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateStatus(fu.id, "done")}
                        className="flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Done
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenMenuId((v) => v === fu.id ? null : fu.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMenuId === fu.id && (
                          <div className="absolute right-0 top-full mt-1 z-10 w-36 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                            <button type="button" onClick={() => { updateStatus(fu.id, "skipped"); setOpenMenuId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50">
                              <SkipForward className="h-3.5 w-3.5 text-slate-400" /> Skip
                            </button>
                            <button type="button" onClick={() => { deleteFollowUp(fu.id); setOpenMenuId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50">
                              <X className="h-3.5 w-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <FollowUpFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSave={load}
      />
    </div>
  )
}
