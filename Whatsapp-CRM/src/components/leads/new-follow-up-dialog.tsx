"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bell, Phone, UserPlus, X } from "lucide-react"

interface ContactOption {
  id: string
  name?: string | null
  phone?: string | null
  alternate_phone?: string | null
}

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

/** Enough digits to be a phone number rather than part of a name. */
function looksLikePhone(q: string) {
  return /^\+?[\d\s-]{10,16}$/.test(q.trim())
}

/**
 * "Call this person back at this time" — the Follow-up tab's own form.
 *
 * Search finds a contact by name, number or alternate number. A number
 * nobody has yet can be added from the same box. Saving puts the
 * customer's lead in Follow-up and sets the reminder that raises the
 * callback alert when it falls due.
 */
export function NewFollowUpDialog({
  open, onClose, onSaved,
}: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<ContactOption[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selected, setSelected] = useState<ContactOption | null>(null)
  const [newNumber, setNewNumber] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [when, setWhen] = useState(defaultWhen)
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  function reset() {
    setQuery(""); setOptions([]); setSelected(null); setNewNumber(null); setNewName("")
    setWhen(defaultWhen()); setDescription(""); setShowDropdown(false)
  }
  function close() { reset(); onClose() }

  function search(v: string) {
    setQuery(v)
    setSelected(null)
    setNewNumber(null)
    if (timer.current) clearTimeout(timer.current)
    const q = v.trim()
    if (q.length < 2) { setOptions([]); setShowDropdown(false); return }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current
      setSearching(true)
      try {
        // Contacts store numbers without spaces or "+", so search on
        // the digits when what was typed is a number.
        const term = looksLikePhone(q) ? q.replace(/\D/g, "").replace(/^0/, "") : q
        const r = await fetch(`/api/contacts?search=${encodeURIComponent(term)}&limit=8`).then((x) => x.json())
        if (mine !== seq.current) return
        setOptions(Array.isArray(r.contacts) ? r.contacts : [])
        setShowDropdown(true)
      } catch { /* the box still accepts a new number */ }
      finally { if (mine === seq.current) setSearching(false) }
    }, 300)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!selected && !newNumber) {
      toast.error("Pick a contact, or add the number as new")
      return
    }
    if (!description.trim()) { toast.error("Add a description"); return }
    const due = new Date(`${when.date}T${when.time}`)
    if (Number.isNaN(due.getTime())) { toast.error("Choose a date and time"); return }

    setSaving(true)
    try {
      const res = await fetch("/api/leads/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: selected?.id,
          phone: selected ? undefined : newNumber,
          name: selected ? undefined : newName.trim() || undefined,
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
  const canAddNew = looksLikePhone(query) && !selected

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={close} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-white rounded-t-2xl">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            <Bell className="h-4 w-4 text-orange-500" /> New Follow-up
          </h2>
          <button type="button" onClick={close} aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-4">
          {/* Contact */}
          <div>
            <label htmlFor="fu-contact" className="block text-[12px] font-medium text-slate-600 mb-1.5">Contact *</label>
            {selected ? (
              <div className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-slate-900 truncate">{selected.name || selected.phone}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {selected.phone}
                    {selected.alternate_phone ? ` · Alt ${selected.alternate_phone}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => { setSelected(null); setQuery("") }} aria-label="Change contact"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : newNumber ? (
              <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="flex-1 text-[13px] font-medium text-slate-900">New contact · {newNumber}</p>
                  <button type="button" onClick={() => { setNewNumber(null); setNewName("") }} aria-label="Remove new number"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input id="fu-new-name" autoComplete="off" className={INPUT + " bg-white"} placeholder="Name (optional)"
                  value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} />
              </div>
            ) : (
              <div className="relative">
                <input id="fu-contact" autoComplete="off" className={INPUT + " pr-8"}
                  placeholder="Search name or number, or type a new number"
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  onFocus={() => (options.length > 0 || canAddNew) && setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
                )}
                {showDropdown && (options.length > 0 || canAddNew) && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                    {options.map((c) => (
                      <button key={c.id} type="button"
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-indigo-50 text-left transition-colors"
                        onMouseDown={() => { setSelected(c); setShowDropdown(false) }}>
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                          {(c.name || c.phone || "?")[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-slate-900 truncate">{c.name || "No name"}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {c.phone}
                            {c.alternate_phone ? ` · Alt ${c.alternate_phone}` : ""}
                          </p>
                        </div>
                      </button>
                    ))}
                    {canAddNew && (
                      <button type="button"
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 border-t border-slate-100 hover:bg-emerald-50 text-left transition-colors"
                        onMouseDown={() => { setNewNumber(query.trim()); setShowDropdown(false) }}>
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                          <Phone className="h-3.5 w-3.5 text-emerald-600" />
                        </div>
                        <p className="text-[13px] font-medium text-emerald-700">Add {query.trim()} as a new contact</p>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* When */}
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

          {/* What */}
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
            <button type="submit" disabled={saving || (!selected && !newNumber) || !description.trim()}
              className="flex-1 rounded-lg py-2 text-[13px] font-medium text-white disabled:opacity-50 transition-colors bg-orange-500 hover:bg-orange-600">
              {saving ? "Saving…" : "Schedule Follow-up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
