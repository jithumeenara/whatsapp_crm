"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, X } from "lucide-react"
import { ContactPicker, type PickedContact } from "./contact-picker"

const INPUT =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"

/** yyyy-mm-dd and hh:mm in the browser's own clock, which is what the
 *  date and time inputs show and read back. */
function localParts(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function defaultWhen() {
  // The next whole hour: a reminder a minute from now is rarely meant.
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return localParts(d)
}

/**
 * "Call this person back at this time" — the Follow-up tab's own form.
 *
 * A contact on record, or a new one (number, name, alternate number);
 * a date, a time and what it is about. Saving puts the customer's lead
 * in Follow-up and sets the reminder that raises the callback alert
 * when it falls due.
 */
export function NewFollowUpDialog({
  open, onClose, onSaved,
}: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const router = useRouter()
  const [picked, setPicked] = useState<PickedContact>(null)
  const [when, setWhen] = useState(defaultWhen)
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  function close() {
    setPicked(null); setWhen(defaultWhen()); setDescription("")
    onClose()
  }

  const hasContact =
    picked?.kind === "existing" || (picked?.kind === "new" && picked.contact.phone.trim().length > 0)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!hasContact || !picked) { toast.error("Pick a contact, or add a new one"); return }
    if (!description.trim()) { toast.error("Add a description"); return }
    const due = new Date(`${when.date}T${when.time}`)
    if (Number.isNaN(due.getTime())) { toast.error("Choose a date and time"); return }

    setSaving(true)
    try {
      const res = await fetch("/api/leads/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(picked.kind === "existing"
            ? { contact_id: picked.contact.id }
            : {
                phone: picked.contact.phone,
                name: picked.contact.name.trim() || undefined,
                alternate_phone: picked.contact.alternate_phone.trim() || undefined,
              }),
          due_at: due.toISOString(),
          description: description.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? "Could not save the follow-up"); return }
      toast.success("Follow-up scheduled", {
        action: data.lead_id ? { label: "Open lead", onClick: () => router.push(`/leads/${data.lead_id}`) } : undefined,
      })
      onSaved()
      close()
    } catch {
      toast.error("Could not save the follow-up")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  const today = localParts(new Date()).date

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-white rounded-t-2xl">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            <Bell className="h-4 w-4 text-orange-500" /> New Follow-up
          </h2>
          <button type="button" onClick={close} aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-4">
          <ContactPicker value={picked} onChange={setPicked} idPrefix="fu" required />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fu-date" className="block text-[12px] font-medium text-slate-600 mb-1.5">Schedule date *</label>
              <input id="fu-date" type="date" required min={today} className={INPUT}
                value={when.date} onChange={(e) => setWhen((w) => ({ ...w, date: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="fu-time" className="block text-[12px] font-medium text-slate-600 mb-1.5">Schedule time *</label>
              <input id="fu-time" type="time" required className={INPUT}
                value={when.time} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
            </div>
          </div>

          <div>
            <label htmlFor="fu-desc" className="block text-[12px] font-medium text-slate-600 mb-1.5">Description *</label>
            <textarea id="fu-desc" rows={3} required maxLength={2000}
              className={INPUT + " resize-none"}
              placeholder="What the call is about — e.g. wants the next batch dates and fees"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={close}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !hasContact || !description.trim()}
              className="flex-1 rounded-lg py-2 text-[13px] font-medium text-white disabled:opacity-50 transition-colors bg-orange-500 hover:bg-orange-600">
              {saving ? "Saving…" : "Schedule Follow-up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
