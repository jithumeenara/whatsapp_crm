"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Plus, Search, Trash2, Edit2, MoreVertical, RefreshCw, Settings2, X } from "lucide-react"
import { toast } from "sonner"
import { RecordForm } from "@/components/data/record-form"
import { FieldEditor } from "@/components/data/field-editor"
import type { DataTable, DataField, DataRecord } from "@/lib/data-store/types"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

function formatValue(field: DataField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const str = String(value)
  if (field.field_type === "date") {
    const d = /^\d{10}$/.test(str) ? new Date(parseInt(str) * 1000) : new Date(str)
    return isNaN(d.getTime()) ? str : d.toLocaleDateString()
  }
  if (field.field_type === "boolean") return value ? "Yes" : "No"
  return str.length > 60 ? str.slice(0, 60) + "…" : str
}

export default function DataTablePage() {
  const { tableId } = useParams<{ tableId: string }>()
  const router = useRouter()

  const [table, setTable] = useState<DataTable | null>(null)
  const [fields, setFields] = useState<DataField[]>([])
  const [records, setRecords] = useState<DataRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<DataRecord | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [fieldPanelOpen, setFieldPanelOpen] = useState(false)
  const [allTables, setAllTables] = useState<DataTable[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, rRes] = await Promise.all([
        fetch(`/api/data-tables/${tableId}`),
        fetch(`/api/data-tables/${tableId}/records?limit=200`),
      ])
      if (!tRes.ok) { router.push("/data"); return }
      const tData = await tRes.json()
      const rData = await rRes.json()
      setTable(tData.table)
      setFields(tData.fields ?? [])
      setRecords(rData.records ?? [])
    } catch { toast.error("Failed to load table") }
    finally { setLoading(false) }
  }, [tableId, router])

  useEffect(() => { load() }, [load])

  const openFieldPanel = useCallback(async () => {
    setFieldPanelOpen(true)
    if (allTables.length === 0) {
      try {
        const res = await fetch("/api/data-tables")
        const data = await res.json()
        setAllTables(data.tables ?? [])
      } catch { /* ignore */ }
    }
  }, [allTables.length])

  async function deleteRecord(id: string) {
    setDeleting(id)
    try {
      await fetch(`/api/data-tables/${tableId}/records/${id}`, { method: "DELETE" })
      setRecords((p) => p.filter((r) => r.id !== id))
      toast.success("Record deleted")
    } catch { toast.error("Delete failed") }
    finally { setDeleting(null); setMenuOpenId(null) }
  }

  const filtered = records.filter((r) => {
    if (!search) return true
    return Object.values(r.data as Record<string, unknown>).some((v) =>
      String(v ?? "").toLowerCase().includes(search.toLowerCase())
    )
  })

  const visibleFields = fields.slice(0, 7)

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <button onClick={() => router.push("/data")}
          className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4 text-slate-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-[16px] font-bold text-slate-800">{table?.name ?? "Loading…"}</h1>
          <p className="text-[12px] text-slate-400">{records.length} records · {fields.length} fields</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search records…"
            className="h-8 pl-8 pr-3 text-[13px] bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-400 w-52" />
        </div>
        <button onClick={load} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
          <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
        </button>
        <button onClick={openFieldPanel}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 text-slate-700 text-[13px] font-medium hover:bg-slate-50">
          <Settings2 className="h-3.5 w-3.5" /> Fields
        </button>
        <button onClick={() => { setEditingRecord(null); setFormOpen(true) }}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700">
          <Plus className="h-3.5 w-3.5" /> Add Record
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-10 bg-white rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <p className="text-[14px] font-medium">No records yet. Add your first record!</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-8">#</th>
                  {visibleFields.map((f) => (
                    <th key={f.id} className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec, idx) => {
                  const data = rec.data as Record<string, unknown>
                  return (
                    <tr key={rec.id} className="border-b border-slate-50 hover:bg-indigo-50/20 transition-colors">
                      <td className="px-4 py-2.5 text-slate-400">{idx + 1}</td>
                      {visibleFields.map((f) => (
                        <td key={f.id} className="px-4 py-2.5 text-slate-700 max-w-[180px] truncate">
                          {formatValue(f, data[f.field_key])}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right">
                        <div className="relative inline-block">
                          <button onClick={() => setMenuOpenId(menuOpenId === rec.id ? null : rec.id)}
                            className="p-1 rounded hover:bg-slate-100">
                            <MoreVertical className="h-4 w-4 text-slate-400" />
                          </button>
                          {menuOpenId === rec.id && (
                            <div className="absolute right-0 top-6 z-20 w-36 bg-white border border-slate-100 rounded-xl shadow-lg overflow-hidden">
                              <button onClick={() => { setEditingRecord(rec); setFormOpen(true); setMenuOpenId(null) }}
                                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-slate-700 hover:bg-slate-50">
                                <Edit2 className="h-3.5 w-3.5" /> Edit
                              </button>
                              <button onClick={() => deleteRecord(rec.id)} disabled={deleting === rec.id}
                                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-rose-600 hover:bg-rose-50">
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <RecordForm
          open={formOpen}
          tableId={tableId}
          fields={fields}
          record={editingRecord ?? undefined}
          onClose={() => { setFormOpen(false); setEditingRecord(null) }}
          onSaved={() => { setFormOpen(false); setEditingRecord(null); load() }}
        />
      )}

      {/* Fields slide-over panel */}
      {fieldPanelOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setFieldPanelOpen(false)} />
          <div className="relative z-50 w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-800">Manage Fields</h2>
                <p className="text-[11px] text-slate-400">{fields.length} field{fields.length !== 1 ? "s" : ""} in {table?.name}</p>
              </div>
              <button onClick={() => setFieldPanelOpen(false)} className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <FieldEditor
                tableId={tableId}
                fields={fields}
                allTables={allTables}
                onFieldsChange={(updated) => { setFields(updated) }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
