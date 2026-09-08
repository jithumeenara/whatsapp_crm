"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { GitMerge, Loader2, Search, ArrowRight, AlertTriangle } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Contact } from "@/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The contact the "Merge with…" action was opened from. */
  primary: Contact
  /** When provided (the bulk-select path), skips the search step —
   *  both contacts are already known. */
  secondary?: Contact
  onMerged: () => void
}

const MERGEABLE_FIELDS: { key: keyof Contact; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
  { key: "alternate_phone", label: "Alternate phone" },
]

function channelChips(c: Contact) {
  const chips: string[] = []
  if (c.phone && !c.phone.startsWith("email:")) chips.push("WhatsApp")
  if (c.instagram_id) chips.push("Instagram")
  if (c.facebook_id) chips.push("Facebook")
  return chips
}

/**
 * IG·04 — Merge Contacts. Deliberately manual at every step: no fuzzy
 * auto-matching (the search below is a plain text match the user reads
 * and picks from themselves), no silent field overwrites (a survivor
 * value is only replaced when the user explicitly picks the other side),
 * and no hard delete (the absorbed contact stays in the DB, soft-flagged).
 */
export function MergeContactsDialog({ open, onOpenChange, primary, secondary, onMerged }: Props) {
  const [step, setStep] = useState<"search" | "compare">(secondary ? "compare" : "search")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Contact[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<Contact | null>(secondary ?? null)
  const [survivorSide, setSurvivorSide] = useState<"primary" | "other">("primary")
  const [fieldChoices, setFieldChoices] = useState<Record<string, "survivor" | "merged">>({})
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(secondary ? "compare" : "search")
    setPicked(secondary ?? null)
    setQuery("")
    setResults([])
    setSurvivorSide("primary")
    setFieldChoices({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, secondary?.id])

  useEffect(() => {
    if (step !== "search" || !query.trim()) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/contacts?search=${encodeURIComponent(query.trim())}&limit=8`)
        .then((r) => r.json())
        .then((d) => setResults((d.contacts ?? []).filter((c: Contact) => c.id !== primary.id)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query, step, primary.id])

  const other = picked
  const survivor = survivorSide === "primary" ? primary : other
  const merged = survivorSide === "primary" ? other : primary

  const conflicts = useMemo(() => {
    if (!survivor || !merged) return []
    return MERGEABLE_FIELDS.filter((f) => survivor[f.key] && merged[f.key] && survivor[f.key] !== merged[f.key])
  }, [survivor, merged])

  async function handleMerge() {
    if (!survivor || !merged) return
    setMerging(true)
    try {
      const res = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          survivor_id: survivor.id,
          merged_id: merged.id,
          field_choices: fieldChoices,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Failed to merge contacts"); return }
      toast.success("Contacts merged.")
      onOpenChange(false)
      onMerged()
    } catch {
      toast.error("Failed to merge — network error.")
    } finally {
      setMerging(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 sm:max-w-lg">
        <div className="flex items-center gap-3 pb-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
            <GitMerge className="h-4.5 w-4.5 text-indigo-600" />
          </span>
          <div>
            <DialogTitle className="text-[15px] font-semibold text-slate-900">Merge Contacts</DialogTitle>
            <DialogDescription className="text-[12.5px] text-slate-500">
              Combine two records that are the same person into one.
            </DialogDescription>
          </div>
        </div>

        {step === "search" ? (
          <div className="mt-2 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, phone, or email…"
                className="h-9 pl-9"
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {searching && <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>}
              {!searching && query.trim() && results.length === 0 && (
                <p className="py-4 text-center text-[12.5px] text-slate-400">No matching contacts found.</p>
              )}
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setPicked(c); setStep("compare") }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-slate-800">{c.name || c.phone}</p>
                    <p className="truncate text-[11.5px] text-slate-400">{c.phone} {c.email ? `· ${c.email}` : ""}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">{channelChips(c).join(", ")}</span>
                </button>
              ))}
            </div>
          </div>
        ) : other ? (
          <div className="mt-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[primary, other].map((c, i) => {
                const isSurvivor = (i === 0 && survivorSide === "primary") || (i === 1 && survivorSide === "other")
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSurvivorSide(i === 0 ? "primary" : "other")}
                    className={`rounded-xl border-2 p-3 text-left transition-colors ${isSurvivor ? "border-indigo-400 bg-indigo-50/50" : "border-slate-150 bg-white hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${isSurvivor ? "text-indigo-600" : "text-slate-400"}`}>
                        {isSurvivor ? "Keep this one" : "Click to keep instead"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[13.5px] font-semibold text-slate-900">{c.name || c.phone}</p>
                    <p className="truncate text-[11.5px] text-slate-500">{c.phone}</p>
                    {c.email && <p className="truncate text-[11.5px] text-slate-400">{c.email}</p>}
                    <p className="mt-1 text-[10.5px] font-medium text-slate-400">{channelChips(c).join(" · ") || "No channel yet"}</p>
                  </button>
                )
              })}
            </div>

            {conflicts.length > 0 && survivor && merged && (
              <div className="space-y-2 rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> These fields differ — pick which value to keep
                </p>
                {conflicts.map((f) => (
                  <div key={String(f.key)} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="shrink-0 font-medium text-slate-600">{f.label}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setFieldChoices((p) => ({ ...p, [f.key]: "survivor" }))}
                        className={`truncate rounded-md border px-2 py-1 ${(fieldChoices[f.key] ?? "survivor") === "survivor" ? "border-indigo-300 bg-indigo-100 text-indigo-700" : "border-slate-200 text-slate-500"}`}
                      >
                        {String(survivor[f.key])}
                      </button>
                      <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" />
                      <button
                        type="button"
                        onClick={() => setFieldChoices((p) => ({ ...p, [f.key]: "merged" }))}
                        className={`truncate rounded-md border px-2 py-1 ${fieldChoices[f.key] === "merged" ? "border-indigo-300 bg-indigo-100 text-indigo-700" : "border-slate-200 text-slate-500"}`}
                      >
                        {String(merged[f.key])}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[12px] text-slate-500">
              {merged?.name || merged?.phone}&apos;s conversations, deals, leads, tags, and activity will move into{" "}
              <b>{survivor?.name || survivor?.phone}</b>. The other record stays in your CRM for history, but won&apos;t
              appear in Contacts anymore. This can&apos;t be undone from the UI.
            </p>

            <div className="flex gap-2">
              {!secondary && (
                <Button variant="outline" onClick={() => setStep("search")} disabled={merging} className="h-9 text-[13px] border-slate-200">
                  Back
                </Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={merging} className="h-9 flex-1 text-[13px] border-slate-200">
                Cancel
              </Button>
              <Button onClick={handleMerge} disabled={merging} className="h-9 flex-1 gap-1.5 bg-indigo-600 text-[13px] text-white hover:bg-indigo-700">
                {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                {merging ? "Merging…" : "Merge Contacts"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
