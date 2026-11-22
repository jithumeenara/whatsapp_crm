"use client"

/**
 * On the lead page: who on the phone number this lead is for, and
 * "Change person" (the number's owner, another person on the number, or a
 * new one). Several people can be booked through one number; each lead is
 * for one of them. Server: PATCH /api/leads/[id] { person_id } and
 * POST /api/contacts/[id]/people.
 */

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, UserRound } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { PersonChooser, type PersonChoice } from "@/components/leads/person-chooser"

export function LeadPerson({ leadId, contactId, ownerName, person, canEdit, onChanged }: Readonly<{
  leadId: string
  contactId: string | null
  ownerName: string | null
  person: { id: string; name: string; relation?: string | null } | null
  canEdit: boolean
  onChanged: () => void
}>) {
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState<PersonChoice>(person ? { kind: "existing", id: person.id, name: person.name } : { kind: "owner" })
  const [saving, setSaving] = useState(false)

  if (!contactId) return null

  async function save() {
    if (saving) return
    if (choice.kind === "new" && !choice.name.trim()) { toast.error("Enter the person's name."); return }
    setSaving(true)
    try {
      let personId: string | null = null
      if (choice.kind === "existing") personId = choice.id
      if (choice.kind === "new") {
        const res = await apiFetch(`/api/contacts/${contactId}/people`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: choice.name.trim(), relation: choice.relation.trim() || null }),
        })
        const body = (await res.json()) as { person?: { id: string } }
        if (!body.person?.id) throw new Error("The person was not saved.")
        personId = body.person.id
      }
      await apiFetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId }),
      })
      toast.success("Saved who this lead is for.")
      setEditing(false)
      onChanged()
    } catch (err) {
      console.error("[lead person] save failed:", err)
      toast.error(errorText(err, "Could not change the person."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-2.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[13px] text-slate-700">
          <span className="text-slate-500">For: </span>
          {person ? (
            <>
              <span className="font-semibold text-slate-900">{person.name}</span>
              {person.relation ? <span className="text-slate-500"> ({person.relation})</span> : null}
              {ownerName ? <span className="text-slate-400"> · on {ownerName}&apos;s number</span> : null}
            </>
          ) : (
            <span className="font-semibold text-slate-900">{ownerName || "the number's owner"}</span>
          )}
        </p>
        {canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="h-7 shrink-0 rounded-lg px-2 text-[12px] font-medium text-indigo-700 hover:bg-indigo-50">
            Change person
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <PersonChooser contactId={contactId} ownerName={ownerName} value={choice} onChange={setChoice} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="h-8 rounded-lg px-3 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
