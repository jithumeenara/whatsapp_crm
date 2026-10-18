"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, GitMerge, Phone, Mail, MessageCircle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirm } from "@/hooks/use-confirm"
import { apiFetch, errorText } from "@/lib/api-fetch"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

interface DupContact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  conversations: number
  last_message_at: string | null
  created_at: string
}
interface DupGroup { reasons: string[]; contacts: DupContact[] }

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })

/**
 * Contacts → "Find duplicates": the contacts that are probably one person
 * (same number, same email, alternate number), a group at a time. Pick
 * the one to keep — the busiest record with a real number is chosen for
 * you — and merge the others into it. Nothing is merged without a click.
 */
export function FindDuplicatesDialog({ open, onOpenChange, onMerged }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onMerged: () => void
}) {
  const confirm = useConfirm()
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  const [error, setError] = useState("")
  const [keep, setKeep] = useState<Record<number, string>>({})
  const [skip, setSkip] = useState<Record<number, Set<string>>>({})
  const [busy, setBusy] = useState<number | "all" | null>(null)
  const [progress, setProgress] = useState("")

  const load = useCallback(async () => {
    setGroups(null)
    setError("")
    try {
      const res = await apiFetch("/api/contacts/duplicates")
      const d = (await res.json()) as { groups?: DupGroup[] }
      setGroups(d.groups ?? [])
      setKeep({})
      setSkip({})
    } catch (err) {
      console.error("[duplicates] load failed:", err)
      setError(errorText(err, "Could not look for duplicates."))
      setGroups([])
    }
  }, [])

  useEffect(() => { if (open) void load() }, [open, load])

  const keepOf = (i: number, g: DupGroup) => keep[i] ?? g.contacts[0]?.id
  const toMerge = (i: number, g: DupGroup) => g.contacts.filter((c) => c.id !== keepOf(i, g) && !skip[i]?.has(c.id)).map((c) => c.id)

  async function mergeGroup(i: number, g: DupGroup): Promise<boolean> {
    const ids = toMerge(i, g)
    if (ids.length === 0) return false
    const res = await apiFetch("/api/contacts/duplicates/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ survivor_id: keepOf(i, g), merged_ids: ids }),
    })
    const d = (await res.json()) as { merged: number; failed: Array<{ error: string }> }
    if (d.failed?.length) toast.warning(`${d.merged} merged, ${d.failed.length} could not be: ${d.failed[0].error}`)
    return true
  }

  async function mergeOne(i: number, g: DupGroup) {
    if (busy !== null) return
    setBusy(i)
    try {
      if (await mergeGroup(i, g)) {
        toast.success("Merged")
        setGroups((gs) => (gs ?? []).filter((_, j) => j !== i))
        setKeep({})
        setSkip({})
        onMerged()
      }
    } catch (err) {
      console.error("[duplicates] merge failed:", err)
      toast.error(errorText(err, "Could not merge these contacts"))
    } finally {
      setBusy(null)
    }
  }

  async function mergeAll() {
    if (!groups?.length || busy !== null) return
    const ok = await confirm({
      title: `Merge all ${groups.length} groups?`,
      description: "Each group becomes the contact marked “Keep”. Their chats, leads, tags and history move to it. This can't be undone from here.",
      confirmLabel: "Merge all",
    })
    if (!ok) return
    setBusy("all")
    let done = 0
    const left: DupGroup[] = []
    for (let i = 0; i < groups.length; i++) {
      setProgress(`Merging ${i + 1} of ${groups.length}…`)
      try {
        if (await mergeGroup(i, groups[i])) done++
        else left.push(groups[i])
      } catch (err) {
        console.error("[duplicates] merge failed:", err)
        left.push(groups[i])
      }
    }
    setProgress("")
    setBusy(null)
    setGroups(left)
    setKeep({})
    setSkip({})
    onMerged()
    if (left.length) toast.warning(`${done} groups merged, ${left.length} left to look at`)
    else toast.success(`${done} groups merged`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (busy === null) onOpenChange(o) }}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Find duplicates</DialogTitle>
          <DialogDescription>
            Contacts with the same number (written differently), the same email, or a matching alternate number. Same name alone never counts.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-live="polite">
          {groups === null ? (
            <p className="flex items-center gap-2 py-10 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Looking through your contacts…</p>
          ) : error ? (
            <p className="py-6 text-[13px] text-rose-700">{error} <button type="button" onClick={() => void load()} className="font-medium text-indigo-700 hover:underline">Try again</button></p>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-600" aria-hidden />
              <p className="text-[14px] font-semibold text-slate-700">No duplicates found</p>
              <p className="text-[12.5px] text-slate-500">Every contact looks like a different person.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {groups.map((g, i) => (
                <li key={g.contacts.map((c) => c.id).join("-")} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {g.reasons.map((r) => (
                      <span key={r} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{r}</span>
                    ))}
                  </div>
                  <fieldset className="space-y-1.5">
                    <legend className="sr-only">Which contact to keep</legend>
                    {g.contacts.map((c) => {
                      const kept = keepOf(i, g) === c.id
                      const skipped = skip[i]?.has(c.id) ?? false
                      return (
                        <div key={c.id} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2", kept ? "border-emerald-400 bg-emerald-50" : "border-slate-200")}>
                          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                            <input type="radio" name={`keep-${i}`} checked={kept} onChange={() => setKeep((k) => ({ ...k, [i]: c.id }))} className="mt-1 h-4 w-4 accent-emerald-600" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-slate-800">{c.name || c.phone || c.email || "No name"}</span>
                              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-slate-500">
                                {c.phone && <span className="inline-flex items-center gap-1 tabular-nums"><Phone className="h-3 w-3" aria-hidden />{c.phone}</span>}
                                {c.email && <span className="inline-flex min-w-0 items-center gap-1"><Mail className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{c.email}</span></span>}
                                <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" aria-hidden />{c.conversations} chat{c.conversations === 1 ? "" : "s"}</span>
                                <span>{c.last_message_at ? `Last message ${dateFmt.format(new Date(c.last_message_at))}` : `Added ${dateFmt.format(new Date(c.created_at))}`}</span>
                              </span>
                            </span>
                          </label>
                          {kept ? (
                            <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">Keep</span>
                          ) : (
                            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] text-slate-600">
                              <input type="checkbox" checked={!skipped} className="h-3.5 w-3.5 accent-indigo-600"
                                onChange={(e) => setSkip((s) => {
                                  const set = new Set(s[i] ?? [])
                                  if (e.target.checked) set.delete(c.id); else set.add(c.id)
                                  return { ...s, [i]: set }
                                })} />
                              Merge in
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </fieldset>
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" variant="outline" disabled={busy !== null || toMerge(i, g).length === 0} onClick={() => void mergeOne(i, g)}>
                      {busy === i ? <Loader2 className="animate-spin" aria-hidden /> : <GitMerge aria-hidden />} Merge
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {groups && groups.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <p className="text-[12px] text-slate-500">{progress || `${groups.length} group${groups.length === 1 ? "" : "s"} found. Chats, leads, tags and history move to the contact kept.`}</p>
            <Button disabled={busy !== null} onClick={() => void mergeAll()}>
              {busy === "all" ? <Loader2 className="animate-spin" aria-hidden /> : <GitMerge aria-hidden />} Merge all
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
