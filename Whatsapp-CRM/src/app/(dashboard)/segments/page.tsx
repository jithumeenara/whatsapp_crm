"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { UsersRound, Plus, Pencil, Trash2, Tag } from "lucide-react"
import type { Tag as TagType } from "@/types"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const PRESET_COLORS = [
  "#6366f1","#10b981","#f59e0b","#f43f5e","#0ea5e9","#8b5cf6","#ec4899","#14b8a6",
]

export default function SegmentsV2() {
  const [tags, setTags] = useState<TagType[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTag, setEditTag] = useState<TagType | null>(null)
  const [form, setForm] = useState({ name: "", color: PRESET_COLORS[0] })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await fetch("/api/tags").then((r) => r.json())
      setTags(Array.isArray(data) ? data : (data?.tags ?? []))
    } catch { toast.error("Failed to load tags") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openCreate() { setForm({ name: "", color: PRESET_COLORS[0] }); setCreateOpen(true) }
  function openEdit(tag: TagType) { setForm({ name: tag.name, color: tag.color }); setEditTag(tag) }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editTag) {
        await fetch(`/api/tags/${editTag.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        })
        setEditTag(null)
        toast.success("Tag updated")
      } else {
        await fetch("/api/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        })
        setCreateOpen(false)
        toast.success("Tag created")
      }
      load()
    } catch { toast.error("Failed to save") }
    finally { setSaving(false) }
  }

  async function del(id: string) {
    try {
      await fetch(`/api/tags/${id}`, { method: "DELETE" })
      toast.success("Tag deleted"); setDeleteId(null); load()
    } catch { toast.error("Failed") }
  }

  const isOpen = createOpen || !!editTag

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50">
              <UsersRound className="h-4 w-4 text-teal-600" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-slate-900">Segments & Tags</h1>
              <p className="text-[11px] text-slate-500">{tags.length} tag{tags.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button type="button" onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition-colors">
            <Plus className="h-3.5 w-3.5" /> New Tag
          </button>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-100 h-[70px] animate-pulse" />)}
          </div>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4"><Tag className="h-7 w-7 text-slate-400" /></div>
            <p className="text-[14px] font-semibold text-slate-700">No tags yet</p>
            <p className="mt-1 text-[12px] text-slate-400">Create tags to organize and segment your contacts</p>
            <button type="button" onClick={openCreate} className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700">
              <Plus className="h-3.5 w-3.5" /> Create Tag
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tags.map((tag) => (
              <div key={tag.id} className="group bg-white rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-4 flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center" style={{ background: tag.color + "20" }}>
                  <Tag className="h-4 w-4" style={{ color: tag.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-900 truncate">{tag.name}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" onClick={() => openEdit(tag)} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={() => setDeleteId(tag.id)} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { setCreateOpen(false); setEditTag(null) }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-[15px] font-semibold text-slate-900 mb-4">{editTag ? "Edit Tag" : "New Tag"}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Name</label>
                <input
                  autoFocus
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"
                  placeholder="e.g. VIP Customer"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      className={cn("h-8 w-8 rounded-lg transition-all", form.color === c ? "ring-2 ring-offset-2 ring-indigo-500 scale-110" : "hover:scale-105")}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => { setCreateOpen(false); setEditTag(null) }} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !form.name.trim()} className="flex-1 rounded-lg bg-indigo-600 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[15px] font-semibold text-slate-900 mb-2">Delete Tag?</h2>
            <p className="text-[13px] text-slate-500 mb-5">Contacts with this tag will be untagged.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteId(null)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => del(deleteId)} className="flex-1 rounded-lg bg-rose-600 py-2 text-[13px] font-medium text-white hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
