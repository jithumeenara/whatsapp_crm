"use client"

/**
 * Split screen: phone numbers that already carry two or more leads with no
 * person — bookings made before "several people on one number", when a
 * second patient's lead went onto the same contact. For each lead pick who
 * it is for: the number's owner, a person already on the number, or a new
 * person (the lead's title is offered as the name). Saved one lead at a
 * time through the people API and PATCH /api/leads/[id].
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, Loader2, Phone, Users } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { EmptyState } from "@/components/ui/empty-state"

interface LeadRow { id: string; title: string; status: string; created_at: string }
interface PersonRow { id: string; name: string; relation: string | null }
interface NumberRow { contact: { id: string; name: string | null; phone: string | null }; leads: LeadRow[]; people: PersonRow[] }

const OWNER = "__owner"
const NEW = "__new"

export function SplitPeople() {
  const [numbers, setNumbers] = useState<NumberRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const [version, setVersion] = useState(0)
  const load = useCallback(() => setVersion((v) => v + 1), [])
  useEffect(() => {
    let cancelled = false
    apiFetch("/api/leads/split-candidates")
      .then((r) => r.json())
      .then((b: { numbers?: NumberRow[] }) => {
        if (cancelled) return
        setNumbers(Array.isArray(b.numbers) ? b.numbers : [])
        setFailed(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("[split] load failed:", err)
        setFailed(true)
        toast.error(errorText(err, "Could not load the bookings to split."))
      })
    return () => { cancelled = true }
  }, [version])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-slate-900">Give each lead its person</h1>
      <p className="mt-1 text-sm text-slate-500">
        These numbers have several leads from before people could share a number. Choose who each lead is for, so every person keeps their own name, age and details.
      </p>
      <div className="mt-5 space-y-4">
        {numbers === null && !failed ? (
          <div className="flex justify-center py-12 text-slate-400" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></div>
        ) : failed ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            Could not load. <button type="button" onClick={load} className="font-semibold text-slate-800 underline">Try again</button>
          </p>
        ) : numbers && numbers.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" aria-hidden />} title="Nothing to split" description="No number has several leads without a person." />
        ) : (
          numbers?.map((n) => <NumberCard key={n.contact.id} row={n} onDone={load} />)
        )}
      </div>
    </div>
  )
}

function NumberCard({ row, onDone }: { row: NumberRow; onDone: () => void }) {
  const [people, setPeople] = useState<PersonRow[]>(row.people)
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={`Number ${row.contact.phone ?? ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 truncate text-[14px] font-semibold text-slate-900">{row.contact.name || "No name"}</p>
        {row.contact.phone ? <span className="inline-flex items-center gap-1 text-[12px] tabular-nums text-slate-500"><Phone className="h-3 w-3" aria-hidden />{row.contact.phone}</span> : null}
        <span className="text-[12px] text-slate-400">· {row.leads.length} leads without a person</span>
      </div>
      <ul className="mt-3 space-y-2">
        {row.leads.map((l) => (
          <LeadSplitRow key={l.id} contactId={row.contact.id} ownerName={row.contact.name} lead={l} people={people}
            onPersonAdded={(p) => setPeople((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, p]))} onSaved={onDone} />
        ))}
      </ul>
    </section>
  )
}

function LeadSplitRow({ contactId, ownerName, lead, people, onPersonAdded, onSaved }: {
  contactId: string; ownerName: string | null; lead: LeadRow; people: PersonRow[]
  onPersonAdded: (p: PersonRow) => void; onSaved: () => void
}) {
  // A lead titled with someone else's name is most likely for a new person.
  const titleIsOwner = (ownerName ?? "").trim().toLowerCase() === lead.title.trim().toLowerCase()
  const [choice, setChoice] = useState<string>(titleIsOwner ? OWNER : NEW)
  const [name, setName] = useState(titleIsOwner ? "" : lead.title.slice(0, 120))
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function save() {
    if (saving || done) return
    if (choice === NEW && !name.trim()) { toast.error("Enter the person's name."); return }
    setSaving(true)
    try {
      let personId: string | null = null
      if (choice === NEW) {
        const res = await apiFetch(`/api/contacts/${contactId}/people`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }),
        })
        const b = (await res.json()) as { person?: PersonRow }
        if (!b.person?.id) throw new Error("The person was not saved.")
        personId = b.person.id
        onPersonAdded(b.person)
      } else if (choice !== OWNER) {
        personId = choice
      }
      if (personId) {
        await apiFetch(`/api/leads/${lead.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person_id: personId }),
        })
      }
      setDone(true)
      toast.success(personId ? "Saved." : "Kept for the number's owner.")
      if (personId) onSaved()
    } catch (err) {
      console.error("[split] save failed:", err)
      toast.error(errorText(err, "Could not save this lead."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/leads/${lead.id}`} className="min-w-0 truncate text-[13px] font-medium text-slate-800 hover:underline" title={lead.title}>{lead.title}</Link>
        <span className="text-[11px] text-slate-400">{new Date(lead.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {lead.status.replace(/_/g, " ")}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Who is this lead for</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={done}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
            <option value={OWNER}>The number&apos;s owner{ownerName ? ` — ${ownerName}` : ""}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.relation ? ` (${p.relation})` : ""}</option>)}
            <option value={NEW}>A new person…</option>
          </select>
        </label>
        {choice === NEW && !done ? (
          <label className="order-last min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
            <span className="sr-only">New person&apos;s name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" placeholder="Name"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800" />
          </label>
        ) : null}
        <button type="button" onClick={() => void save()} disabled={saving || done}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : done ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          {done ? "Saved" : "Save"}
        </button>
      </div>
    </li>
  )
}
