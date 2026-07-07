"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, LayoutGrid, MoreVertical } from "lucide-react"
import { CreateTableDialog } from "@/components/data/create-table-dialog"
import type { DataTable } from "@/lib/data-store/types"
import { getIconEmoji } from "@/lib/data-store/types"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

export default function DataStoreV2() {
  const router = useRouter()
  const [tables, setTables] = useState<DataTable[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/data-tables")
      const data = await res.json()
      setTables(data.tables ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const deleteTable = async (id: string) => {
    if (!confirm("Delete this table and all its records? This cannot be undone.")) return
    setDeleting(id)
    try {
      await fetch(`/api/data-tables/${id}`, { method: "DELETE" })
      setTables((prev) => prev.filter((t) => t.id !== id))
    } finally { setDeleting(null) }
  }

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-lg">🗄️</div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">Data Store</h1>
              <p className="text-[11px] text-slate-500">Custom tables for any data</p>
            </div>
          </div>
          <button type="button" onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
            <Plus className="h-3.5 w-3.5" /> New Table
          </button>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-[100px] animate-pulse" />)}
          </div>
        ) : tables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-slate-200 text-center">
            <div className="text-5xl mb-4">🗄️</div>
            <p className="text-[14px] font-semibold text-slate-700">No tables yet</p>
            <p className="mt-1 text-[12px] text-slate-400">Create custom tables — doctors, products, inventory, and more</p>
            <button type="button" onClick={() => setCreateOpen(true)} className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700">
              <Plus className="h-3.5 w-3.5" /> New Table
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tables.map((table) => (
              <div
                key={table.id}
                className="group relative bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-5 cursor-pointer hover:border-indigo-200 hover:shadow-[0_2px_8px_rgba(99,102,241,0.1)] transition-all"
                onClick={() => router.push(`/data/${table.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl">
                      {getIconEmoji(table.icon)}
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-slate-900">{table.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{table.fields?.length ?? 0} field{(table.fields?.length ?? 0) !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === table.id ? null : table.id) }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                    {menuOpenId === table.id && (
                      <div className="absolute right-0 top-8 z-10 w-36 rounded-xl border border-slate-200 bg-white py-1 shadow-lg" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => { setMenuOpenId(null); deleteTable(table.id) }} disabled={deleting === table.id}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-rose-600 hover:bg-rose-50">
                          <Trash2 className="h-3.5 w-3.5" /> {deleting === table.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {table.description && (
                  <p className="mt-3 text-[12px] text-slate-500 line-clamp-2">{table.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateTableDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(t) => { router.push(`/data/${t.id}`) }} />
    </div>
  )
}
