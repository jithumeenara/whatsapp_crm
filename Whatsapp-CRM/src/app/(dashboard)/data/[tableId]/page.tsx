"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Plus, Search, Trash2, Edit2, MoreVertical,
  RefreshCw, Settings2, X, Upload, Download, Loader2,
  Database, AlertTriangle, ChevronRight, ChevronLeft,
  Type, AlignLeft, Hash, Mail, KeyRound, Phone, Link2, Calendar, Clock,
  CalendarClock, ToggleLeft, ChevronDown, ListChecks, CircleDot, Globe,
  MapPin, Home, Link as LinkIcon, Paperclip, ImageIcon, PenLine, EyeOff,
  Heading, Code2,
} from "lucide-react"
import { toast } from "sonner"
import { RecordForm } from "@/components/data/record-form"
import { FieldEditor } from "@/components/data/field-editor"
import { RecordDetailModal } from "@/components/data/record-detail-modal"
import type { DataTable, DataField, DataRecord, FieldType } from "@/lib/data-store/types"

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

const FIELD_TYPE_ICONS: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  text: Type, textarea: AlignLeft, number: Hash, email: Mail, password: KeyRound,
  phone: Phone, url: Link2, date: Calendar, time: Clock, datetime: CalendarClock,
  boolean: ToggleLeft, select: ChevronDown, multiselect: ListChecks, radio: CircleDot,
  country: Globe, state: MapPin, district: MapPin, address: Home, relation: LinkIcon,
  file: Paperclip, image: ImageIcon, signature: PenLine, hidden: EyeOff,
  section_header: Heading, html_block: Code2,
}

function formatValue(field: DataField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const str = String(value)
  if (field.field_type === "date") {
    const d = /^\d{10}$/.test(str) ? new Date(parseInt(str) * 1000) : new Date(str)
    return isNaN(d.getTime()) ? str : d.toLocaleDateString()
  }
  if (field.field_type === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return (value as string[]).join(", ")
  return str.length > 56 ? str.slice(0, 56) + "…" : str
}

// ── Confirm Dialog ──────────────────────────────────────────────
function ConfirmDialog({ open, title, message, confirmLabel = "Delete", onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string
  onConfirm: () => void; onCancel: () => void
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
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-slate-900 leading-snug">{title}</p>
            <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="h-8 px-3 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="h-8 px-3 rounded-lg bg-rose-500 text-[13px] font-medium text-white hover:bg-rose-600 transition-colors">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const [confirmRecordId, setConfirmRecordId] = useState<string | null>(null)
  const [viewingRecord, setViewingRecord] = useState<DataRecord | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, rRes] = await Promise.all([
        fetch(`/api/data-tables/${tableId}`),
        fetch(`/api/data-tables/${tableId}/records?pageSize=200`),
      ])
      if (!tRes.ok) { router.push("/data"); return }
      const tData = await tRes.json()
      const rData = await rRes.json()
      setTable(tData.table)
      setFields(tData.table?.fields ?? [])
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

  async function downloadTemplate() {
    try {
      const res = await fetch(`/api/data-tables/${tableId}/import`)
      if (!res.ok) { toast.error("Failed to generate template"); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${table?.name ?? "template"}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error("Failed to generate template") }
  }

  async function handleImport(file: File) {
    setImporting(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/data-tables/${tableId}/import`, { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Import failed"); return }
      toast.success(`Imported ${data.count} record${data.count !== 1 ? "s" : ""}`)
      load()
    } catch { toast.error("Import failed") }
    finally { setImporting(false) }
  }

  async function confirmDelete() {
    if (!confirmRecordId) return
    const id = confirmRecordId
    setConfirmRecordId(null)
    setDeleting(id)
    try {
      await fetch(`/api/data-tables/${tableId}/records/${id}`, { method: "DELETE" })
      setRecords((p) => p.filter((r) => r.id !== id))
      toast.success("Record deleted")
    } catch { toast.error("Delete failed") }
    finally { setDeleting(null) }
  }

  async function confirmBulkDeleteRecords() {
    const ids = Array.from(selectedIds)
    setConfirmBulkDelete(false)
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/data-tables/${tableId}/records/${id}`, { method: "DELETE" })),
      )
      const failed = results.filter((r) => r.status === "rejected").length
      setRecords((p) => p.filter((r) => !selectedIds.has(r.id)))
      setSelectedIds(new Set())
      if (failed > 0) toast.error(`${failed} record${failed !== 1 ? "s" : ""} failed to delete`)
      else toast.success(`${ids.length} record${ids.length !== 1 ? "s" : ""} deleted`)
    } catch { toast.error("Bulk delete failed") }
    finally { setBulkDeleting(false) }
  }

  const filtered = records.filter((r) => {
    if (!search) return true
    return Object.values(r.data as Record<string, unknown>).some((v) =>
      String(v ?? "").toLowerCase().includes(search.toLowerCase())
    )
  })

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRecords = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // Reset to page 1 whenever the search narrows/widens the result set —
  // otherwise a stale page number could point past the new last page.
  useEffect(() => { setPage(1) }, [search])

  // "Select all" scopes to the current page, matching the visible rows.
  const allPageSelected = pageRecords.length > 0 && pageRecords.every((r) => selectedIds.has(r.id))

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const r of pageRecords) next.delete(r.id)
      } else {
        for (const r of pageRecords) next.add(r.id)
      }
      return next
    })
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // The table wrapper below already scrolls horizontally (overflow-x-auto),
  // so every field can render as its own column instead of being capped.
  const visibleFields = fields

  return (
    <div className="flex flex-col h-full bg-[#F4F6FA]">

      {/* Backdrop — closes any open row menu */}
      {menuOpenId && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setMenuOpenId(null)}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="flex items-center gap-2 px-4 h-14 flex-wrap">
          <button
            onClick={() => router.push("/data")}
            className="flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1.5 text-[13px] text-slate-400 min-w-0">
            <Database className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Data Store</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold text-slate-800 truncate">{table?.name ?? "…"}</span>
          </div>

          {!loading && (
            <div className="hidden md:flex items-center gap-3 text-[12px] text-slate-400 ml-1">
              <span><span className="font-semibold text-slate-600">{records.length}</span> records</span>
              <span><span className="font-semibold text-slate-600">{fields.length}</span> fields</span>
            </div>
          )}

          <div className="flex-1" />

          {/* Action strip */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-8 w-36 sm:w-44 pl-8 pr-3 text-[13px] rounded-lg border border-slate-200 bg-slate-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>

            <div className="h-5 w-px bg-slate-200" />

            <button onClick={load} title="Refresh"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>

            <button onClick={openFieldPanel}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              <Settings2 className="h-3.5 w-3.5" /> Fields
            </button>

            <button onClick={downloadTemplate} title="Download Excel template"
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              <Download className="h-3.5 w-3.5" /> Template
            </button>

            <button onClick={() => importRef.current?.click()} disabled={importing}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Import
            </button>
            <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImport(f); e.target.value = "" } }} />

            <div className="h-5 w-px bg-slate-200" />

            <button
              onClick={() => { setEditingRecord(null); setFormOpen(true) }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 active:scale-95 transition-all"
            >
              <Plus className="h-3.5 w-3.5" /> Add Record
            </button>
          </div>
        </div>

        {/* Selection bar — its own row, never squeezed into the main
            toolbar, so it can never force that fixed-height row to wrap
            and overlap the table below it. */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 h-10 border-t border-indigo-100 bg-indigo-50">
            <span className="text-[12px] font-medium text-indigo-700">{selectedIds.size} selected</span>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              Clear
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setConfirmBulkDelete(true)}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-[12px] font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50 transition-colors"
            >
              {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Table grid */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <TableSkeleton />
        ) : fields.length === 0 ? (
          <NoFieldsState onFields={openFieldPanel} />
        ) : filtered.length === 0 && records.length === 0 ? (
          <NoRecordsState onAdd={() => { setEditingRecord(null); setFormOpen(true) }} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Search className="h-8 w-8 mb-3 text-slate-300" />
            <p className="text-[14px] font-medium text-slate-500">No records match</p>
            <button onClick={() => setSearch("")} className="mt-1.5 text-[12px] text-indigo-600 hover:underline">
              Clear search
            </button>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-auto">
              <table className="w-full text-[13px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-20 bg-indigo-50/70 backdrop-blur-sm px-3 py-2.5 text-left w-10 border-b-2 border-indigo-100">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer"
                        aria-label="Select all rows on this page"
                      />
                    </th>
                    {visibleFields.map((f) => {
                      const TypeIcon = FIELD_TYPE_ICONS[f.field_type] ?? Type
                      return (
                        <th key={f.id} title={f.field_type} className="sticky top-0 z-10 bg-indigo-50/70 backdrop-blur-sm px-4 py-2.5 text-left border-b-2 border-indigo-100 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <TypeIcon className="h-3 w-3 text-indigo-400 shrink-0" />
                            <span className="text-[11px] font-semibold text-indigo-900/80 tracking-wide">{f.label}</span>
                          </div>
                        </th>
                      )
                    })}
                    <th className="sticky top-0 right-0 z-20 bg-indigo-50/70 backdrop-blur-sm px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-indigo-400 w-14 border-b-2 border-indigo-100">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((rec, idx) => {
                    const data = rec.data as Record<string, unknown>
                    const isMenuOpen = menuOpenId === rec.id
                    const isSelected = selectedIds.has(rec.id)
                    const zebra = idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                    const rowBg = isSelected ? "bg-indigo-50" : zebra
                    return (
                      <tr key={rec.id} className={cn("group border-b border-slate-100 last:border-0 hover:bg-indigo-50/50 transition-colors", rowBg)}>
                        <td className={cn("sticky left-0 z-10 px-3 py-2.5 border-r border-slate-100 w-10 transition-colors", isSelected ? "bg-indigo-50" : zebra, "group-hover:bg-indigo-50/50")}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectOne(rec.id)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer"
                            aria-label={`Select row ${(currentPage - 1) * PAGE_SIZE + idx + 1}`}
                          />
                        </td>
                        {visibleFields.map((f) => {
                          const raw = data[f.field_key]
                          return (
                            <td
                              key={f.id}
                              onClick={() => setViewingRecord(rec)}
                              className="px-4 py-2.5 text-slate-700 max-w-[220px] border-r border-slate-50/80 cursor-pointer"
                              title="Click to view full details"
                            >
                              {f.field_type === "boolean" ? (
                                <span className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                  raw ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500",
                                )}>
                                  {raw ? "Yes" : "No"}
                                </span>
                              ) : (
                                <span className={cn(
                                  "block truncate",
                                  (f.field_type === "email" || f.field_type === "url" || f.field_type === "phone") && "font-mono text-[12px] text-slate-600",
                                  f.field_type === "number" && "font-mono text-[12px] tabular-nums",
                                  (raw === null || raw === undefined || raw === "") && "text-slate-300",
                                )}>
                                  {formatValue(f, raw)}
                                </span>
                              )}
                            </td>
                          )
                        })}
                        <td className={cn(
                          "sticky right-0 px-3 py-2.5 text-right border-l border-slate-100 transition-colors group-hover:bg-indigo-50/50",
                          isSelected ? "bg-indigo-50" : zebra,
                          // Boosted above every other row's sticky cell (which all sit at
                          // z-10) only while its own menu is open — otherwise later rows
                          // in the DOM win z-index ties and swallow clicks meant for this
                          // row's open dropdown.
                          isMenuOpen ? "z-40" : "z-10",
                        )}>
                          <div className="relative z-30 inline-flex justify-end">
                            <button
                              onClick={() => setMenuOpenId(isMenuOpen ? null : rec.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 transition-all"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>

                            {isMenuOpen && (
                              <div className="absolute right-0 top-8 w-40 rounded-xl border border-slate-100 bg-white py-1 shadow-xl">
                                <button
                                  onClick={() => {
                                    setMenuOpenId(null)
                                    setEditingRecord(rec)
                                    setFormOpen(true)
                                  }}
                                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                  <Edit2 className="h-3.5 w-3.5 text-slate-400" />
                                  Edit record
                                </button>
                                <div className="mx-2 my-0.5 h-px bg-slate-100" />
                                <button
                                  onClick={() => {
                                    setMenuOpenId(null)
                                    setConfirmRecordId(rec.id)
                                  }}
                                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
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

            {/* Pagination footer */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2.5 shrink-0">
              <p className="text-[11px] text-slate-400">
                {filtered.length === records.length
                  ? `${records.length} record${records.length !== 1 ? "s" : ""}`
                  : `${filtered.length} of ${records.length} records`}
                {pageCount > 1 && ` · Page ${currentPage} of ${pageCount}`}
              </p>
              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-[11px] font-medium text-slate-600 px-1 tabular-nums">
                    {currentPage} / {pageCount}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={currentPage >= pageCount}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Record form dialog */}
      {formOpen && (
        <RecordForm
          open={formOpen}
          tableId={tableId}
          fields={fields}
          record={editingRecord}
          onClose={() => { setFormOpen(false); setEditingRecord(null) }}
          onSaved={() => { setFormOpen(false); setEditingRecord(null); load() }}
        />
      )}

      {/* Record detail popup */}
      {viewingRecord && (
        <RecordDetailModal
          record={viewingRecord}
          fields={fields}
          onClose={() => setViewingRecord(null)}
          onEdit={() => {
            setEditingRecord(viewingRecord)
            setViewingRecord(null)
            setFormOpen(true)
          }}
          onDelete={() => {
            setConfirmRecordId(viewingRecord.id)
            setViewingRecord(null)
          }}
        />
      )}

      {/* Fields slide-over */}
      {fieldPanelOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px]" onClick={() => setFieldPanelOpen(false)} />
          <div className="relative z-50 w-full max-w-[420px] bg-white flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900">Manage Fields</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {fields.length} field{fields.length !== 1 ? "s" : ""} · {table?.name}
                </p>
              </div>
              <button
                onClick={() => setFieldPanelOpen(false)}
                className="flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <FieldEditor
                tableId={tableId}
                fields={fields}
                allTables={allTables}
                onFieldsChange={(updated) => setFields(updated)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!confirmRecordId}
        title="Delete record?"
        message="This record will be permanently deleted and cannot be recovered."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmRecordId(null)}
      />

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} record${selectedIds.size !== 1 ? "s" : ""}?`}
        message="These records will be permanently deleted and cannot be recovered."
        confirmLabel="Delete"
        onConfirm={confirmBulkDeleteRecords}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}

function TableSkeleton() {
  return (
    <div className="h-full">
      <div className="h-10 bg-indigo-50/70 border-b-2 border-indigo-100" />
      <div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={cn("h-11 border-b border-slate-100 last:border-0", i % 2 !== 0 && "bg-slate-50/60")}>
            <div className="flex items-center gap-4 px-4 h-full">
              <div className="h-3 w-4 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-28 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-20 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-16 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function NoFieldsState({ onFields }: { onFields: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
        <Settings2 className="h-6 w-6 text-slate-400" />
      </div>
      <h3 className="text-[15px] font-semibold text-slate-700 mb-1">No fields defined</h3>
      <p className="text-[13px] text-slate-400 text-center max-w-xs mb-5">
        Add fields to define the structure of your table before adding records.
      </p>
      <button onClick={onFields}
        className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 transition-colors">
        <Settings2 className="h-3.5 w-3.5" /> Add Fields
      </button>
    </div>
  )
}

function NoRecordsState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 mb-4">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="3" y="6" width="22" height="16" rx="2" stroke="#4F46E5" strokeWidth="1.5" fill="none" />
          <line x1="3" y1="11" x2="25" y2="11" stroke="#4F46E5" strokeWidth="1.5" />
          <line x1="10" y1="6" x2="10" y2="22" stroke="#4F46E5" strokeWidth="1.5" />
          <circle cx="21" cy="21" r="4.5" fill="#4F46E5" />
          <line x1="21" y1="19.2" x2="21" y2="22.8" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="19.2" y1="21" x2="22.8" y2="21" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="text-[15px] font-semibold text-slate-700 mb-1">No records yet</h3>
      <p className="text-[13px] text-slate-400 text-center max-w-xs mb-5">
        Add your first record manually, or import from an Excel file using the Import button above.
      </p>
      <button onClick={onAdd}
        className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-700 transition-colors">
        <Plus className="h-3.5 w-3.5" /> Add Record
      </button>
    </div>
  )
}
