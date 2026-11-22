"use client"

/**
 * "People on this number" — on the contact page and the Inbox sidebar.
 * Several people can be booked through one phone number (a family at a
 * clinic, a parent for two children). List, add, edit and remove; removing
 * is refused by the server while a lead is for that person (rename them
 * instead). Server: /api/contacts/[id]/people(/[personId]).
 */

import { useCallback, useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { Loader2, Pencil, Plus, Trash2, Users, X } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { useAuth } from "@/hooks/use-auth"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface Person { id: string; name: string; relation: string | null; age: number | null; gender: string | null; address: string | null; leads: number }
interface Draft { name: string; relation: string; age: string; gender: string; address: string }

const EMPTY: Draft = { name: "", relation: "", age: "", gender: "", address: "" }
const GENDER_LABEL: Record<string, string> = { male: "Male", female: "Female", trans: "Trans", prefer_not_to_say: "Prefer not to say" }
const INPUT = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"

const toDraft = (p: Person): Draft => ({ name: p.name, relation: p.relation ?? "", age: p.age != null ? String(p.age) : "", gender: p.gender ?? "", address: p.address ?? "" })

export function PeopleOnNumber({ contactId, compact = false }: Readonly<{ contactId: string; compact?: boolean }>) {
  const { accountRole } = useAuth()
  const canEdit = Boolean(accountRole && accountRole !== "viewer")
  const [people, setPeople] = useState<Person[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null) // person id, or "new"
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/contacts/${contactId}/people`)
      .then((r) => r.json())
      .then((b: { people?: Person[] }) => { if (!cancelled) setPeople(Array.isArray(b.people) ? b.people : []) })
      .catch((err) => {
        if (cancelled) return
        console.error("[people] load failed:", err)
        setPeople([])
        toast.error(errorText(err, "Could not load the people on this number."))
      })
    return () => { cancelled = true }
  }, [contactId, version])

  function start(id: string | "new") {
    const p = people?.find((x) => x.id === id)
    setDraft(p ? toDraft(p) : EMPTY)
    setEditing(id)
  }

  async function save() {
    if (busy || !editing) return
    if (!draft.name.trim()) { toast.error("Give the person a name."); return }
    setBusy(true)
    try {
      const body = JSON.stringify({ name: draft.name.trim(), relation: draft.relation.trim() || null, age: draft.age.trim(), gender: draft.gender, address: draft.address.trim() })
      await apiFetch(editing === "new" ? `/api/contacts/${contactId}/people` : `/api/contacts/${contactId}/people/${editing}`, {
        method: editing === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
      })
      toast.success(editing === "new" ? "Person added." : "Saved.")
      setEditing(null)
      reload()
    } catch (err) {
      console.error("[people] save failed:", err)
      toast.error(errorText(err, "Could not save the person."))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await apiFetch(`/api/contacts/${contactId}/people/${id}`, { method: "DELETE" })
      toast.success("Person removed.")
      reload()
    } catch (err) {
      console.error("[people] remove failed:", err)
      toast.error(errorText(err, "Could not remove the person."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="People on this number" className={compact ? "space-y-2" : "space-y-2 rounded-xl border border-slate-200 bg-white p-4"}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Users className="h-3.5 w-3.5" aria-hidden="true" /> People on this number
        </p>
        {canEdit && editing === null ? (
          <button type="button" onClick={() => start("new")} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-indigo-700 hover:bg-indigo-50">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add person
          </button>
        ) : null}
      </div>

      {people === null ? (
        <div className="h-8 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" aria-busy="true" aria-label="Loading people" />
      ) : people.length === 0 && editing !== "new" ? (
        <p className="text-[12px] text-slate-500">Only the number&apos;s owner so far. Add a person when someone else (a child, a parent) is booked through this number.</p>
      ) : (
        <ul className="space-y-1.5">
          {people.map((p) => editing === p.id ? (
            <li key={p.id}><PersonForm draft={draft} setDraft={setDraft} busy={busy} onSave={save} onCancel={() => setEditing(null)} /></li>
          ) : (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-800" title={p.name}>
                  {p.name}{p.relation ? <span className="font-normal text-slate-500"> ({p.relation})</span> : null}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {[p.age != null ? `${p.age} y` : null, p.gender ? GENDER_LABEL[p.gender] ?? p.gender : null, p.leads ? `${p.leads} lead${p.leads === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </div>
              {canEdit ? (
                <>
                  <button type="button" onClick={() => start(p.id)} disabled={busy || editing !== null} aria-label={`Edit ${p.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setRemoveId(p.id)} disabled={busy || editing !== null} aria-label={`Remove ${p.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </li>
          ))}
          {editing === "new" ? <li><PersonForm draft={draft} setDraft={setDraft} busy={busy} onSave={save} onCancel={() => setEditing(null)} /></li> : null}
        </ul>
      )}

      <ConfirmDialog
        open={removeId !== null}
        title="Remove this person?"
        description="Only the person record is removed. A person who has leads cannot be removed — rename them instead."
        confirmLabel="Remove"
        variant="destructive"
        onCancel={() => setRemoveId(null)}
        onConfirm={() => { const id = removeId; setRemoveId(null); if (id) void remove(id) }}
      />
    </section>
  )
}

function PersonForm({ draft, setDraft, busy, onSave, onCancel }: {
  draft: Draft; setDraft: (d: Draft) => void; busy: boolean; onSave: () => void; onCancel: () => void
}) {
  const uid = useId()
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave() }} className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem]">
        <div>
          <label htmlFor={`${uid}-n`} className="mb-0.5 block text-[11px] font-medium text-slate-600">Name *</label>
          <input id={`${uid}-n`} className={INPUT} value={draft.name} maxLength={120} autoComplete="off" required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${uid}-r`} className="mb-0.5 block text-[11px] font-medium text-slate-600">Relation</label>
          <input id={`${uid}-r`} className={INPUT} value={draft.relation} maxLength={40} autoComplete="off" placeholder="e.g. son" onChange={(e) => setDraft({ ...draft, relation: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${uid}-a`} className="mb-0.5 block text-[11px] font-medium text-slate-600">Age</label>
          <input id={`${uid}-a`} className={INPUT} value={draft.age} type="number" inputMode="numeric" min={0} max={120} autoComplete="off" onChange={(e) => setDraft({ ...draft, age: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${uid}-g`} className="mb-0.5 block text-[11px] font-medium text-slate-600">Gender</label>
          <select id={`${uid}-g`} className={INPUT} value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value })}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="trans">Trans</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-ad`} className="mb-0.5 block text-[11px] font-medium text-slate-600">Address</label>
        <textarea id={`${uid}-ad`} className={`${INPUT} resize-none`} rows={2} maxLength={500} value={draft.address} autoComplete="off" placeholder="Leave empty to use the contact's" onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100">
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
        </button>
        <button type="submit" disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null} Save
        </button>
      </div>
    </form>
  )
}
