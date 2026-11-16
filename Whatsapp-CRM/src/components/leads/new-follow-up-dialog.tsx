"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, Loader2 } from "lucide-react"
import { ContactPicker, type PickedContact } from "./contact-picker"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

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
    if (saving) return
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
    if (due.getTime() < Date.now() - 60_000) { toast.error("That time has already passed. Choose a later one."); return }
    if (saving) return

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
      setSaving(false)
      setPicked(null); setWhen(defaultWhen()); setDescription("")
      onClose()
    } catch (err) {
      console.error("[follow-up] save failed:", err)
      toast.error("Could not save the follow-up. Check the connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  const today = localParts(new Date()).date

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain bg-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            <Bell className="h-4 w-4 text-orange-600" aria-hidden="true" /> New follow-up
          </DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500">Who to call back, when, and what about.</DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="space-y-4">
          <ContactPicker value={picked} onChange={setPicked} idPrefix="fu" required />

          <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
            <div>
              <label htmlFor="fu-date" className="block text-[12px] font-medium text-slate-600 mb-1.5">Date <span className="text-rose-600" aria-hidden="true">*</span></label>
              <input id="fu-date" type="date" required min={today} className={INPUT}
                value={when.date} onChange={(e) => setWhen((w) => ({ ...w, date: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="fu-time" className="block text-[12px] font-medium text-slate-600 mb-1.5">Time <span className="text-rose-600" aria-hidden="true">*</span></label>
              <input id="fu-time" type="time" required className={INPUT}
                value={when.time} onChange={(e) => setWhen((w) => ({ ...w, time: e.target.value }))} />
            </div>
          </div>

          <div>
            <label htmlFor="fu-desc" className="block text-[12px] font-medium text-slate-600 mb-1.5">Description <span className="text-rose-600" aria-hidden="true">*</span></label>
            <textarea id="fu-desc" rows={3} required maxLength={2000}
              className={INPUT + " resize-none"}
              placeholder="What the call is about, e.g. wants the next dates and prices"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={close} disabled={saving}
              className="flex-1 rounded-lg border border-slate-200 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || !hasContact || !description.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold text-white disabled:opacity-50 transition-colors bg-orange-600 hover:bg-orange-700">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {saving ? "Saving…" : "Schedule follow-up"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
