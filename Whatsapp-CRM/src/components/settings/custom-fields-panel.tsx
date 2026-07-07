"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Plus, Trash2, Sliders, GripVertical } from "lucide-react"

interface CustomField {
  id: string
  field_name: string
  field_type: string
}

const FIELD_TYPES = [
  { value: "text",     label: "Text",      desc: "Short single-line text" },
  { value: "textarea", label: "Long Text",  desc: "Multi-line text" },
  { value: "number",   label: "Number",    desc: "Numeric value" },
  { value: "date",     label: "Date",      desc: "Date picker" },
  { value: "url",      label: "URL",       desc: "Website link" },
]

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    text:     "bg-slate-100 text-slate-600",
    textarea: "bg-violet-50 text-violet-600",
    number:   "bg-sky-50 text-sky-600",
    date:     "bg-amber-50 text-amber-600",
    url:      "bg-emerald-50 text-emerald-600",
  }
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${colors[type] ?? "bg-slate-100 text-slate-600"}`}>
      {FIELD_TYPES.find((t) => t.value === type)?.label ?? type}
    </span>
  )
}

export function CustomFieldsPanel() {
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState("text")
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/custom-fields")
      if (!res.ok) throw new Error()
      const body = await res.json()
      setFields(body.fields ?? [])
    } catch {
      toast.error("Failed to load custom fields")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    const name = newName.trim()
    if (!name) { toast.error("Field name is required"); return }
    setAdding(true)
    try {
      const res = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field_name: name, field_type: newType }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to add field")
        return
      }
      toast.success("Custom field added")
      setNewName("")
      setNewType("text")
      load()
    } finally { setAdding(false) }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to delete field")
        return
      }
      toast.success("Field deleted")
      setFields((prev) => prev.filter((f) => f.id !== id))
    } finally { setDeletingId(null) }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sliders className="h-4 w-4 text-indigo-600" />
          <h2 className="text-[16px] font-bold text-slate-900">Contact Custom Fields</h2>
        </div>
        <p className="text-[13px] text-slate-500">
          Add extra fields to your contacts — like lead source, budget, or any data your team needs.
        </p>
      </div>

      {/* Add field form */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest mb-4">Add New Field</p>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Name input */}
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
              Field Name
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
              placeholder="e.g. Lead Source, Budget…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all"
            />
          </div>

          {/* Type selector */}
          <div className="sm:w-44">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
              Field Type
            </label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[14px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white outline-none transition-all appearance-none cursor-pointer"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Add button */}
          <div className="sm:self-end">
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {adding
                ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                : <Plus className="h-4 w-4" />}
              {adding ? "Adding…" : "Add Field"}
            </button>
          </div>
        </div>

        {/* Type descriptions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {FIELD_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setNewType(t.value)}
              className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all ${
                newType === t.value
                  ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {t.label}
              <span className="ml-1 text-[10px] opacity-60">— {t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Fields list */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
          <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest">
            {loading ? "Loading…" : `${fields.length} Field${fields.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {loading ? (
          <div className="divide-y divide-slate-100">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4 animate-pulse">
                <div className="h-4 w-4 rounded bg-slate-100" />
                <div className="h-4 w-32 rounded-full bg-slate-100 flex-1" />
                <div className="h-6 w-16 rounded-md bg-slate-100" />
                <div className="h-7 w-7 rounded-lg bg-slate-100" />
              </div>
            ))}
          </div>
        ) : fields.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
              <Sliders className="h-6 w-6 text-slate-300" />
            </div>
            <p className="text-[14px] font-semibold text-slate-700">No custom fields yet</p>
            <p className="text-[12px] text-slate-400 max-w-xs">
              Add fields above to capture extra info on your contacts like budget, source, or anything you need.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {fields.map((field) => (
              <div key={field.id} className="group flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors">
                <GripVertical className="h-4 w-4 text-slate-200 group-hover:text-slate-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-slate-900 truncate">{field.field_name}</p>
                </div>
                <TypeBadge type={field.field_type} />
                <button
                  type="button"
                  onClick={() => handleDelete(field.id)}
                  disabled={deletingId === field.id}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 transition-all opacity-0 group-hover:opacity-100"
                  title="Delete field"
                >
                  {deletingId === field.id
                    ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-400 border-t-transparent" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[12px] text-slate-400">
        Custom fields appear in the contact detail panel under the <strong>Custom</strong> tab.
        Deleting a field will also remove all saved values for that field.
      </p>
    </div>
  )
}
