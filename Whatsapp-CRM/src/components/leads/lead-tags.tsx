"use client"

/**
 * The person's tags, on the lead page: shown, added and removed here.
 *
 * Tags belong to the contact (the Leads list filters on them), so this
 * reads and writes /api/contacts/[id]/tags — the same records the Inbox
 * sidebar and the contact page change. After every change the list is
 * read again from the server, so what shows is what was saved.
 */

import { useCallback, useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Tag as TagIcon, X } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { readableTextColor } from "@/lib/readable-color"

interface TagItem { id: string; name: string; color: string }

const HEX = /^#[0-9a-f]{6}$/i

export function LeadTags({ contactId }: Readonly<{ contactId: string | null }>) {
  const uid = useId()
  const [all, setAll] = useState<TagItem[]>([])
  const [attached, setAttached] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState("")

  const load = useCallback(async () => {
    if (!contactId) { setLoading(false); return }
    try {
      const [mine, every] = await Promise.all([
        apiFetch(`/api/contacts/${contactId}/tags`).then((r) => r.json()),
        apiFetch("/api/tags").then((r) => r.json()),
      ])
      const rows = Array.isArray(mine?.tags) ? (mine.tags as Array<{ tag_id?: string }>) : []
      setAttached(new Set(rows.map((r) => r.tag_id).filter((x): x is string => typeof x === "string")))
      setAll(Array.isArray(every?.tags) ? (every.tags as TagItem[]) : [])
    } catch (err) {
      console.error("[lead tags] load failed:", err)
      toast.error(errorText(err, "Could not load the tags."))
    } finally {
      setLoading(false)
    }
  }, [contactId])

  useEffect(() => { void load() }, [load])

  async function add(tag: TagItem) {
    if (!contactId || busy) return
    setBusy(tag.id)
    try {
      await apiFetch(`/api/contacts/${contactId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tag.id }),
      })
      await load()
      setFilter("")
    } catch (err) {
      console.error("[lead tags] add failed:", err)
      toast.error(errorText(err, `Could not add “${tag.name}”.`))
    } finally {
      setBusy(null)
    }
  }

  async function remove(tag: TagItem) {
    if (!contactId || busy) return
    setBusy(tag.id)
    try {
      await apiFetch(`/api/contacts/${contactId}/tags?tag_id=${encodeURIComponent(tag.id)}`, { method: "DELETE" })
      await load()
    } catch (err) {
      console.error("[lead tags] remove failed:", err)
      toast.error(errorText(err, `Could not remove “${tag.name}”.`))
    } finally {
      setBusy(null)
    }
  }

  const mine = all.filter((t) => attached.has(t.id))
  const q = filter.trim().toLowerCase()
  const available = all.filter((t) => !attached.has(t.id) && (!q || t.name.toLowerCase().includes(q)))
  const swatch = (t: TagItem) => (HEX.test(t.color) ? t.color : "#64748b")

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p id={`${uid}-label`} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <TagIcon className="h-3.5 w-3.5" aria-hidden="true" /> Tags
        </p>
        {contactId && all.length > 0 && (
          <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-indigo-700 hover:bg-indigo-50">
            {adding ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {adding ? "Done" : "Add tag"}
          </button>
        )}
      </div>

      {!contactId ? (
        <p className="text-[12px] italic text-slate-400">This lead has no contact, so it cannot carry tags.</p>
      ) : loading ? (
        <div className="h-7 w-40 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none" aria-busy="true" aria-label="Loading tags" />
      ) : (
        <>
          {mine.length === 0 ? (
            <p className="text-[12px] italic text-slate-400">
              {all.length === 0 ? "No tags yet. Create them in Settings → Contacts → Tags." : "No tags on this person."}
            </p>
          ) : (
            <ul aria-labelledby={`${uid}-label`} className="flex flex-wrap gap-1.5">
              {mine.map((t) => (
                <li key={t.id} className="inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[12px] font-medium"
                  style={{ borderColor: `${swatch(t)}55`, backgroundColor: `${swatch(t)}14`, color: readableTextColor(swatch(t)) }}>
                  <span className="truncate" title={t.name}>{t.name}</span>
                  <button type="button" onClick={() => void remove(t)} disabled={busy !== null} aria-label={`Remove tag ${t.name}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-50">
                    {busy === t.id ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {adding && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
              {all.length - mine.length > 8 && (
                <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" name="tag-filter"
                  aria-label="Find a tag" placeholder="Find a tag…"
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              )}
              {available.length === 0 ? (
                <p className="text-[12px] text-slate-500">{q ? "No tag matches." : "Every tag is already on this person."}</p>
              ) : (
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {available.map((t) => (
                    <button key={t.id} type="button" onClick={() => void add(t)} disabled={busy !== null}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                      {busy === t.id
                        ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        : <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: swatch(t) }} aria-hidden="true" />}
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
