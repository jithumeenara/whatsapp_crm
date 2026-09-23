"use client"

import { useRef, useState } from "react"
import { Phone, Search, UserPlus, X } from "lucide-react"

export interface ContactOption {
  id: string
  name?: string | null
  phone?: string | null
  alternate_phone?: string | null
}

export interface NewContactInput {
  name: string
  phone: string
  alternate_phone: string
}

/** Either a contact on record, or the details of one to add. */
export type PickedContact =
  | { kind: "existing"; contact: ContactOption }
  | { kind: "new"; contact: NewContactInput }
  | null

const INPUT =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"

/** Enough digits to be a phone number rather than part of a name. */
function looksLikePhone(q: string) {
  return /^\+?[\d\s-]{10,16}$/.test(q.trim())
}

/**
 * Pick a contact by name, number or alternate number — or add a new
 * one, from the "New contact" button or straight from a number typed
 * into the search that nobody has yet.
 *
 * Adding here only collects the details. The server matches the number
 * to a contact that already has it before creating anything, so the
 * same person is never entered twice.
 */
export function ContactPicker({
  value, onChange, idPrefix, required,
}: { value: PickedContact; onChange: (v: PickedContact) => void; idPrefix: string; required?: boolean }) {
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<ContactOption[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  function search(v: string) {
    setQuery(v)
    if (timer.current) clearTimeout(timer.current)
    const q = v.trim()
    if (q.length < 2) { setOptions([]); setShowDropdown(false); return }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current
      setSearching(true)
      try {
        // Contacts store numbers without spaces or "+", so search on the
        // digits when what was typed is a number.
        const term = looksLikePhone(q) ? q.replace(/\D/g, "").replace(/^0/, "") : q
        const r = await fetch(`/api/contacts?search=${encodeURIComponent(term)}&limit=8`).then((x) => x.json())
        if (mine !== seq.current) return
        setOptions(Array.isArray(r.contacts) ? r.contacts : [])
        setShowDropdown(true)
      } catch { /* adding a new contact still works */ }
      finally { if (mine === seq.current) setSearching(false) }
    }, 300)
  }

  function startNew(prefill = "") {
    const phone = looksLikePhone(prefill) ? prefill.trim() : ""
    const name = phone ? "" : prefill.trim()
    onChange({ kind: "new", contact: { name, phone, alternate_phone: "" } })
    setShowDropdown(false)
  }

  function clear() {
    onChange(null)
    setQuery("")
    setOptions([])
  }

  const label = (
    <div className="flex items-center justify-between mb-1.5">
      <label htmlFor={`${idPrefix}-contact`} className="block text-[12px] font-medium text-slate-600">
        Contact{required ? " *" : ""}
      </label>
      {value?.kind !== "new" && (
        <button type="button" onClick={() => startNew(query)}
          className="flex items-center gap-1 text-[12px] font-medium text-emerald-600 hover:text-emerald-700">
          <UserPlus className="h-3.5 w-3.5" /> New contact
        </button>
      )}
    </div>
  )

  if (value?.kind === "existing") {
    const c = value.contact
    return (
      <div>
        {label}
        <div className="flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-slate-900 truncate">{c.name || c.phone}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {c.phone}{c.alternate_phone ? ` · Alt ${c.alternate_phone}` : ""}
            </p>
          </div>
          <button type="button" onClick={clear} aria-label="Change contact"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  if (value?.kind === "new") {
    const c = value.contact
    const set = (patch: Partial<NewContactInput>) => onChange({ kind: "new", contact: { ...c, ...patch } })
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
            <UserPlus className="h-3.5 w-3.5" /> New contact
          </p>
          <button type="button" onClick={clear}
            className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-700">
            <Search className="h-3.5 w-3.5" /> Search existing instead
          </button>
        </div>
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div>
            <label htmlFor={`${idPrefix}-new-phone`} className="block text-[11px] font-medium text-slate-600 mb-1">Phone number *</label>
            <input id={`${idPrefix}-new-phone`} type="tel" inputMode="tel" autoComplete="off" required
              className={INPUT + " bg-white"} placeholder="9847012345"
              value={c.phone} maxLength={20} onChange={(e) => set({ phone: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-new-name`} className="block text-[11px] font-medium text-slate-600 mb-1">Name</label>
            <input id={`${idPrefix}-new-name`} autoComplete="off" className={INPUT + " bg-white"} placeholder="Full name"
              value={c.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-new-alt`} className="block text-[11px] font-medium text-slate-600 mb-1">Alternate number</label>
            <input id={`${idPrefix}-new-alt`} type="tel" inputMode="tel" autoComplete="off"
              className={INPUT + " bg-white"} placeholder="Optional"
              value={c.alternate_phone} maxLength={20} onChange={(e) => set({ alternate_phone: e.target.value })} />
          </div>
          <p className="text-[11px] text-slate-500">
            Ten-digit Indian numbers get +91 added. If this number is already saved, that contact is used.
          </p>
        </div>
      </div>
    )
  }

  const canAddTyped = looksLikePhone(query)
  return (
    <div>
      {label}
      <div className="relative">
        <input id={`${idPrefix}-contact`} autoComplete="off" className={INPUT + " pr-8"}
          placeholder="Search name, number or alternate number"
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => (options.length > 0 || canAddTyped) && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
        )}
        {showDropdown && query.trim().length >= 2 && !searching && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            {options.map((c) => (
              <button key={c.id} type="button"
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-indigo-50 text-left transition-colors"
                onMouseDown={() => { onChange({ kind: "existing", contact: c }); setShowDropdown(false) }}>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                  {(c.name || c.phone || "?")[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-900 truncate">{c.name || "No name"}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {c.phone}{c.alternate_phone ? ` · Alt ${c.alternate_phone}` : ""}
                  </p>
                </div>
              </button>
            ))}
            {options.length === 0 && (
              <p className="px-3 py-2.5 text-[12px] text-slate-500">No contact found for “{query.trim()}”.</p>
            )}
            <button type="button"
              className="w-full flex items-center gap-2.5 px-3 py-2.5 border-t border-slate-100 hover:bg-emerald-50 text-left transition-colors"
              onMouseDown={() => startNew(query)}>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                {canAddTyped ? <Phone className="h-3.5 w-3.5 text-emerald-600" /> : <UserPlus className="h-3.5 w-3.5 text-emerald-600" />}
              </div>
              <p className="text-[13px] font-medium text-emerald-700">
                {canAddTyped ? `Add ${query.trim()} as a new contact` : "Add a new contact"}
              </p>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
