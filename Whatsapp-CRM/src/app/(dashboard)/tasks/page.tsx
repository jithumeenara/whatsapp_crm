"use client"

import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import {
  CheckSquare, Plus, Check, Clock, AlertTriangle, MoreHorizontal,
  Flame, ArrowUp, ArrowRight, ArrowDown, X,
} from "lucide-react"

const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const

function TaskFormDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; onSave: () => void }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", due_at: "" })
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    try {
      const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, due_at: form.due_at || undefined }) })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Failed")
      toast.success("Task created")
      onOpenChange(false); onSave(); setForm({ title: "", description: "", priority: "medium", due_at: "" })
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed") }
    finally { setSaving(false) }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-[15px] font-semibold text-slate-900 mb-4">New Task</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1">Title</label>
            <input required placeholder="Task title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1">Priority</label>
            <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none">
              {TASK_PRIORITIES.map((p) => <option key={p} value={p} className="capitalize">{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1">Due Date (optional)</label>
            <input type="datetime-local" value={form.due_at} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1">Description (optional)</label>
            <textarea rows={2} placeholder="Details…" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] resize-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-indigo-600 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? "Saving…" : "Create Task"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

interface Task {
  id: string
  title: string
  description?: string | null
  priority: "urgent" | "high" | "medium" | "low"
  status: "pending" | "in_progress" | "done" | "cancelled"
  due_at?: string | null
  contact?: { name?: string | null; phone: string } | null
  lead?: { title: string } | null
  assigned_to_user?: { profile?: { full_name: string } | null } | null
}

type FilterKey = "pending" | "in_progress" | "done" | "all"

const PRIORITY_CONFIG = {
  urgent: { label: "Urgent",   color: "bg-rose-50 text-rose-700 border-rose-100",   icon: <Flame className="h-3 w-3" /> },
  high:   { label: "High",     color: "bg-orange-50 text-orange-700 border-orange-100", icon: <ArrowUp className="h-3 w-3" /> },
  medium: { label: "Medium",   color: "bg-amber-50 text-amber-700 border-amber-100",    icon: <ArrowRight className="h-3 w-3" /> },
  low:    { label: "Low",      color: "bg-slate-50 text-slate-500 border-slate-200",    icon: <ArrowDown className="h-3 w-3" /> },
}

const STATUS_CONFIG = {
  pending:     { label: "Pending",     color: "bg-amber-50 text-amber-700 border-amber-100" },
  in_progress: { label: "In Progress", color: "bg-sky-50 text-sky-700 border-sky-100" },
  done:        { label: "Done",        color: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  cancelled:   { label: "Cancelled",   color: "bg-slate-100 text-slate-500 border-slate-200" },
}

function isOverdue(due?: string | null, status?: string) {
  if (!due || status === "done" || status === "cancelled") return false
  return new Date(due) < new Date()
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })
}

export default function TasksV2() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>("pending")
  const [createOpen, setCreateOpen] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== "all") params.set("status", filter)
      const data = await fetch(`/api/tasks?${params}`).then((r) => r.json())
      setTasks(Array.isArray(data) ? data : (data?.tasks ?? []))
    } catch {
      toast.error("Failed to load tasks")
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function markDone(id: string) {
    try {
      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      })
      toast.success("Task completed!")
      load()
    } catch {
      toast.error("Failed to update")
    }
  }

  async function deleteTask(id: string) {
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" })
      toast.success("Task deleted")
      load()
    } catch {
      toast.error("Failed to delete")
    }
  }

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "pending",     label: "Pending" },
    { key: "in_progress", label: "In Progress" },
    { key: "done",        label: "Done" },
    { key: "all",         label: "All" },
  ]

  const priorityOrder = ["urgent", "high", "medium", "low"]
  const sorted = [...tasks].sort((a, b) =>
    priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority),
  )

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
              <CheckSquare className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">Tasks</h1>
              <p className="text-[11px] text-slate-500">{loading ? "Loading…" : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> New Task
          </button>
        </div>

        <div className="mt-3 flex gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                filter === f.key ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-2">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 p-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-slate-100 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-slate-100" />
                  <div className="h-3 w-1/2 rounded bg-slate-100" />
                </div>
              </div>
            </div>
          ))
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
              <CheckSquare className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700">No tasks</p>
            <p className="mt-1 text-[12px] text-slate-400">Create a task to track your work</p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> New Task
            </button>
          </div>
        ) : (
          sorted.map((task) => {
            const pri = PRIORITY_CONFIG[task.priority]
            const stat = STATUS_CONFIG[task.status]
            const overdue = isOverdue(task.due_at, task.status)

            return (
              <div
                key={task.id}
                className={cn(
                  "bg-white rounded-xl border p-4 transition-shadow",
                  overdue ? "border-rose-200 bg-rose-50/20" : "border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Complete button */}
                  {task.status !== "done" && task.status !== "cancelled" ? (
                    <button
                      type="button"
                      onClick={() => markDone(task.id)}
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 transition-colors"
                      title="Mark done"
                    />
                  ) : (
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn(
                        "text-[14px] font-semibold",
                        task.status === "done" ? "text-slate-400 line-through" : "text-slate-900",
                      )}>
                        {task.title}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", pri.color)}>
                          {pri.icon}{pri.label}
                        </span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", stat.color)}>
                          {stat.label}
                        </span>
                      </div>
                    </div>

                    {task.description && (
                      <p className="mt-1 text-[12px] text-slate-500">{task.description}</p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {task.due_at && (
                        <span className={cn("flex items-center gap-1 text-[11px] font-medium", overdue ? "text-rose-600" : "text-slate-500")}>
                          {overdue && <AlertTriangle className="h-3 w-3" />}
                          <Clock className="h-3 w-3" />
                          {fmtDate(task.due_at)}
                        </span>
                      )}
                      {task.contact && (
                        <span className="text-[12px] text-slate-500">
                          {task.contact.name ?? task.contact.phone}
                        </span>
                      )}
                      {task.assigned_to_user?.profile && (
                        <span className="text-[12px] text-slate-400">
                          → {task.assigned_to_user.profile.full_name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Menu */}
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setOpenMenuId((v) => v === task.id ? null : task.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {openMenuId === task.id && (
                      <div className="absolute right-0 top-full mt-1 z-10 w-36 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                        <button type="button" onClick={() => { deleteTask(task.id); setOpenMenuId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50">
                          <X className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <TaskFormDialog open={createOpen} onOpenChange={setCreateOpen} onSave={load} />
    </div>
  )
}
