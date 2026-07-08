"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Plus, Trash2, MoreVertical, Search, Database, ChevronRight,
  Table2, Loader2, AlertTriangle,
} from "lucide-react"
import { CreateTableDialog } from "@/components/data/create-table-dialog"
import type { DataTable } from "@/lib/data-store/types"
import { getIconEmoji } from "@/lib/data-store/types"
import { toast } from "sonner"

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

function ConfirmDialog({ open, title, message, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-100 p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-slate-900 leading-snug">{title}</p>
            <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="h-8 px-3 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="h-8 px-3 rounded-lg bg-rose-500 text-[13px] font-medium text-white hover:bg-rose-600 transition-colors">Delete</button>
        </div>
      </div>
    </div>
  )
}

const ICON_COLORS = [
  "bg-indigo-50 text-indigo-600",
  "bg-violet-50 text-violet-600",
  "bg-sky-50 text-sky-600",
  "bg-emerald-50 text-emerald-600",
  "bg-amber-50 text-amber-700",
  "bg-rose-50 text-rose-600",
]

export default function DataStorePage() {
  const router = useRouter()
  const [tables, setTables] = useState<DataTable[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/data-tables")
      const data = await res.json()
      setTables(data.tables ?? [])
    } catch { toast.error("Failed to load tables") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const askDelete = (id: string) => {
    setMenuOpenId(null)
    setConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!confirmId) return
    const id = confirmId
    setConfirmId(null)
    setDeleting(id)
    try {
      await fetch(`/api/data-tables/${id}`, { method: "DELETE" })
      setTables((prev) => prev.filter((t) => t.id !== id))
      toast.success("Table deleted")
    } catch { toast.error("Delete failed") }
    finally { setDeleting(null) }
  }

  const filtered = tables.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">

      {/* Backdrop — closes any open menu */}
      {menuOpenId && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setMenuOpenId(null)}
        />
      )}

      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Database className="h-3.5 w-3.5" />
            </div>
            <span className="text-[15px] font-semibold text-slate-900">Data Store</span>
            {!loading && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">
                {tables.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find table…"
                className="h-8 w-48 pl-8 pr-3 text-[13px] rounded-lg border border-slate-200 bg-slate-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 active:scale-95 transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              New Table
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[108px] rounded-xl bg-white border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          tables.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Search className="h-8 w-8 mb-3 opacity-40" />
              <p className="text-[14px] font-medium text-slate-600">No tables match "{search}"</p>
              <button onClick={() => setSearch("")} className="mt-2 text-[12px] text-indigo-600 hover:underline">
                Clear search
              </button>
            </div>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((table, i) => {
              const colorCls = ICON_COLORS[i % ICON_COLORS.length]
              const fieldCount = table._count?.fields ?? table.fields?.length ?? 0
              const recordCount = table._count?.records ?? 0
              const isMenuOpen = menuOpenId === table.id

              return (
                <div
                  key={table.id}
                  onClick={() => { if (!isMenuOpen) router.push(`/data/${table.id}`) }}
                  className="group relative flex flex-col bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 cursor-pointer hover:border-indigo-200 hover:shadow-[0_2px_12px_rgba(79,70,229,0.10)] transition-all duration-150"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[18px]", colorCls)}>
                        {getIconEmoji(table.icon)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-slate-900 truncate leading-snug">
                          {table.name}
                        </p>
                        {table.description && (
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{table.description}</p>
                        )}
                      </div>
                    </div>

                    {/* Menu — z-30 sits above the z-20 backdrop */}
                    <div className="relative z-30 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMenuOpenId(isMenuOpen ? null : table.id)
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>

                      {isMenuOpen && (
                        <div className="absolute right-0 top-8 w-40 rounded-xl border border-slate-100 bg-white py-1 shadow-xl">
                          <button
                            onClick={(e) => { e.stopPropagation(); askDelete(table.id) }}
                            disabled={deleting === table.id}
                            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                          >
                            {deleting === table.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                            Delete table
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer chips */}
                  <div className="flex items-center gap-2 mt-3.5 pt-3 border-t border-slate-50">
                    <span className="flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      <Table2 className="h-3 w-3" />
                      {fieldCount} field{fieldCount !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
                        <rect x="1" y="1" width="8" height="2" rx="0.5" fill="currentColor" opacity="0.5" />
                        <rect x="1" y="4" width="8" height="2" rx="0.5" fill="currentColor" opacity="0.7" />
                        <rect x="1" y="7" width="8" height="2" rx="0.5" fill="currentColor" />
                      </svg>
                      {recordCount} record{recordCount !== 1 ? "s" : ""}
                    </span>
                    <div className="flex-1" />
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <CreateTableDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(t) => router.push(`/data/${t.id}`)}
      />

      <ConfirmDialog
        open={!!confirmId}
        title="Delete table?"
        message="This will permanently delete the table and all its records. This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 mb-5">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="4" y="8" width="24" height="16" rx="2" stroke="#4F46E5" strokeWidth="1.5" fill="none" />
          <line x1="4" y1="13" x2="28" y2="13" stroke="#4F46E5" strokeWidth="1.5" />
          <line x1="11" y1="8" x2="11" y2="24" stroke="#4F46E5" strokeWidth="1.5" />
          <circle cx="24" cy="24" r="5" fill="#4F46E5" />
          <line x1="24" y1="21.5" x2="24" y2="26.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="21.5" y1="24" x2="26.5" y2="24" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-[16px] font-semibold text-slate-800 mb-1">No tables yet</h3>
      <p className="text-[13px] text-slate-400 text-center max-w-xs mb-5">
        Create custom tables to store any structured data — doctors, products, courses, inventory.
      </p>
      <button
        onClick={onCreate}
        className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Create your first table
      </button>
    </div>
  )
}
