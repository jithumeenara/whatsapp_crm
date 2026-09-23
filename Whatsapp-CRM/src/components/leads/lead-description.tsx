"use client"

import { useState } from "react"
import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react"

/**
 * The lead's description: what it is for and what the person needs.
 *
 * Stored in the lead's `notes`. When nobody has written one yet and the
 * assistant opened the lead, its reason is shown in its place — marked
 * as the assistant's, and one click to keep it as the description.
 */
export function LeadDescription({
  value, suggestion, onSave,
}: { value: string; suggestion: string | null; onSave: (notes: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  async function save(text: string) {
    setSaving(true)
    const ok = await onSave(text.trim())
    setSaving(false)
    if (ok) setEditing(false)
  }

  const showSuggestion = !value.trim() && !!suggestion?.trim()

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Description</p>
        {!editing && (
          <button type="button" onClick={() => { setDraft(value || suggestion || ""); setEditing(true) }}
            className="flex items-center gap-1 text-[12px] font-medium text-indigo-600 hover:text-indigo-700">
            <Pencil className="h-3 w-3" /> {value.trim() ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <label htmlFor="lead-description" className="sr-only">Lead description</label>
          <textarea id="lead-description" rows={3} maxLength={2000} autoFocus
            value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Purpose of the lead and what they need"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setEditing(false); setDraft(value) }} disabled={saving}
              className="flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 text-[12px] font-medium text-slate-600 hover:bg-slate-50">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button type="button" onClick={() => save(draft)} disabled={saving}
              className="flex items-center gap-1 h-8 px-3 rounded-lg bg-indigo-600 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
            </button>
          </div>
        </div>
      ) : value.trim() ? (
        <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words">{value}</p>
      ) : showSuggestion ? (
        <div className="rounded-xl bg-violet-50 px-3 py-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 mb-1">
            <Sparkles className="h-3 w-3" /> From the assistant
          </p>
          <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words">{suggestion}</p>
          <button type="button" onClick={() => save(suggestion ?? "")} disabled={saving}
            className="mt-1.5 text-[12px] font-medium text-violet-700 hover:underline disabled:opacity-60">
            Keep as description
          </button>
        </div>
      ) : (
        <p className="text-[13px] text-slate-400 italic">No description yet — what is this lead for, and what do they need?</p>
      )}
    </div>
  )
}
