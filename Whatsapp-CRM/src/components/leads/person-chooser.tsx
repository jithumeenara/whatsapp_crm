"use client"

/**
 * "Who is this for?" — several people can be booked through one phone
 * number (a family at a clinic, a parent for two children). The lead is for
 * the number's owner, one of the people already on the number, or a person
 * added now. Server: /api/contacts/[id]/people and POST /api/leads
 * (person_id | new_person).
 */

import { useEffect, useId, useState } from "react"
import { UserPlus, Users } from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"

export type PersonChoice =
  | { kind: "owner" }
  | { kind: "existing"; id: string; name: string }
  | { kind: "new"; name: string; relation: string }

interface PersonRow { id: string; name: string; relation: string | null; leads: number }

const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"

/** What POST /api/leads needs for this choice. */
export function personPayload(choice: PersonChoice): Record<string, unknown> {
  if (choice.kind === "existing") return { person_id: choice.id }
  if (choice.kind === "new") return { new_person: { name: choice.name.trim(), relation: choice.relation.trim() || null } }
  return {}
}

export function PersonChooser({ contactId, ownerName, value, onChange, autoFocusName }: Readonly<{
  /** A contact already on record (its people are listed); null for a number being typed. */
  contactId: string | null
  ownerName?: string | null
  value: PersonChoice
  onChange: (v: PersonChoice) => void
  autoFocusName?: boolean
}>) {
  const uid = useId()
  const [people, setPeople] = useState<PersonRow[]>([])

  useEffect(() => {
    if (!contactId) return
    let cancelled = false
    apiFetch(`/api/contacts/${contactId}/people`)
      .then((r) => r.json())
      .then((b: { people?: PersonRow[] }) => { if (!cancelled) setPeople(Array.isArray(b.people) ? b.people : []) })
      .catch((err) => console.error("[person chooser] load failed:", err))
    return () => { cancelled = true }
  }, [contactId])

  const list = contactId ? people : []
  const radio = "h-4 w-4 shrink-0 border-slate-300 text-indigo-600 focus:ring-indigo-200"

  return (
    <fieldset className="min-w-0 space-y-1.5 rounded-lg border border-slate-200 bg-white p-3">
      <legend className="flex items-center gap-1.5 px-1 text-[12px] font-semibold text-slate-700">
        <Users className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" /> Who is this for?
      </legend>
      <label className="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
        <input type="radio" name={`${uid}-who`} className={radio} checked={value.kind === "owner"} onChange={() => onChange({ kind: "owner" })} />
        <span className="min-w-0 truncate">The number&apos;s owner{ownerName ? <span className="text-slate-500"> — {ownerName}</span> : null}</span>
      </label>
      {list.map((p) => (
        <label key={p.id} className="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
          <input type="radio" name={`${uid}-who`} className={radio} checked={value.kind === "existing" && value.id === p.id} onChange={() => onChange({ kind: "existing", id: p.id, name: p.name })} />
          <span className="min-w-0 truncate" title={p.relation ? `${p.name} (${p.relation})` : p.name}>{p.name}{p.relation ? <span className="text-slate-500"> ({p.relation})</span> : null}</span>
          {p.leads > 0 ? <span className="ml-auto shrink-0 text-[11px] text-slate-400">{p.leads} lead{p.leads === 1 ? "" : "s"}</span> : null}
        </label>
      ))}
      <label className="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-indigo-700 hover:bg-indigo-50">
        <input type="radio" name={`${uid}-who`} className={radio} checked={value.kind === "new"} onChange={() => onChange({ kind: "new", name: "", relation: "" })} />
        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add a person on this number
      </label>
      {value.kind === "new" ? (
        <div className="grid grid-cols-1 gap-2 pl-7 pt-1 sm:grid-cols-[1fr_8rem]">
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1 block text-[12px] font-medium text-slate-600">Name <span className="text-rose-600" aria-hidden="true">*</span></label>
            <input id={`${uid}-name`} className={INPUT} value={value.name} maxLength={120} autoComplete="off" required
              autoFocus={autoFocusName}
              placeholder="e.g. Meera" onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${uid}-rel`} className="mb-1 block text-[12px] font-medium text-slate-600">Relation</label>
            <input id={`${uid}-rel`} className={INPUT} value={value.relation} maxLength={40} autoComplete="off"
              placeholder="e.g. daughter" onChange={(e) => onChange({ ...value, relation: e.target.value })} />
          </div>
        </div>
      ) : null}
    </fieldset>
  )
}
