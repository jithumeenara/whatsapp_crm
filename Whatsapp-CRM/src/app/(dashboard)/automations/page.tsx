"use client"

import Link from "next/link"
import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import { Zap, Plus, Play, Pause, Copy, Pencil, Trash2, FileText, MoreHorizontal } from "lucide-react"
import type { Automation } from "@/types"

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

const TRIGGER_LABELS: Record<string, string> = {
  new_message_received: "New message",
  first_inbound_message: "First message",
  keyword_match: "Keyword match",
  new_contact_created: "New contact",
  conversation_assigned: "Conv assigned",
  tag_added: "Tag added",
  time_based: "Scheduled",
}

export default function AutomationsV2() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch("/api/automations").then((r) => r.json())
      setAutomations(Array.isArray(data) ? data : (data?.automations ?? []))
    } catch {
      toast.error("Failed to load automations")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(id: string, active: boolean) {
    setToggling(id)
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: active }),
      })
      setAutomations((prev) => prev.map((a) => a.id === id ? { ...a, is_active: active } : a))
      toast.success(active ? "Automation enabled" : "Automation paused")
    } catch {
      toast.error("Failed to update")
    } finally {
      setToggling(null)
    }
  }

  async function duplicate(id: string) {
    try {
      await fetch(`/api/automations/${id}/duplicate`, { method: "POST" })
      toast.success("Duplicated!")
      load()
    } catch {
      toast.error("Failed to duplicate")
    }
  }

  async function deleteAutomation(id: string) {
    try {
      await fetch(`/api/automations/${id}`, { method: "DELETE" })
      toast.success("Deleted")
      setDeleteId(null)
      load()
    } catch {
      toast.error("Failed to delete")
    }
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
              <Zap className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">Automations</h1>
              <p className="text-[11px] text-slate-500">{automations.length} automation{automations.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <Link
            href="/automations/new"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> New Automation
          </Link>
        </div>
      </div>

      <div className="p-6 space-y-3">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 p-5 h-[100px] animate-pulse" />)
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
              <Zap className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700">No automations yet</p>
            <p className="mt-1 text-[12px] text-slate-400">Automate repetitive tasks and workflows</p>
            <Link href="/automations/new" className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Automation
            </Link>
          </div>
        ) : (
          automations.map((auto) => (
            <div
              key={auto.id}
              className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-4 flex items-center gap-4"
            >
              {/* Active toggle */}
              <button
                type="button"
                onClick={() => toggle(auto.id, !auto.is_active)}
                disabled={toggling === auto.id}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                  auto.is_active ? "bg-emerald-50 hover:bg-emerald-100" : "bg-slate-100 hover:bg-slate-200",
                )}
                title={auto.is_active ? "Pause" : "Activate"}
              >
                {auto.is_active
                  ? <Play className="h-4 w-4 text-emerald-600" />
                  : <Pause className="h-4 w-4 text-slate-400" />}
              </button>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <p className="text-[14px] font-semibold text-slate-900 truncate">{auto.name}</p>
                  <span className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    auto.is_active
                      ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                      : "bg-slate-100 text-slate-500 border-slate-200",
                  )}>
                    {auto.is_active ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                  <span>Trigger: <span className="font-medium text-slate-700">{TRIGGER_LABELS[auto.trigger_type] ?? auto.trigger_type}</span></span>
                  <span>{auto.execution_count} run{auto.execution_count !== 1 ? "s" : ""}</span>
                  {auto.last_executed_at && (
                    <span>Last: {new Date(auto.last_executed_at).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Link
                  href={`/automations/${auto.id}/edit`}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenMenuId((v) => v === auto.id ? null : auto.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {openMenuId === auto.id && (
                    <div className="absolute right-0 top-full mt-1 z-10 w-36 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                      <Link href={`/automations/${auto.id}/logs`} onClick={() => setOpenMenuId(null)} className="flex items-center gap-2 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50">
                        <FileText className="h-3.5 w-3.5 text-slate-400" /> View Logs
                      </Link>
                      <button type="button" onClick={() => { duplicate(auto.id); setOpenMenuId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50">
                        <Copy className="h-3.5 w-3.5 text-slate-400" /> Duplicate
                      </button>
                      <button type="button" onClick={() => { setDeleteId(auto.id); setOpenMenuId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50">
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[15px] font-semibold text-slate-900 mb-2">Delete Automation</h2>
            <p className="text-[13px] text-slate-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteId(null)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button type="button" onClick={() => deleteAutomation(deleteId)} className="flex-1 rounded-lg bg-rose-600 py-2 text-[13px] font-medium text-white hover:bg-rose-700 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
