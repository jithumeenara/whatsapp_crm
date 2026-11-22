"use client"

/**
 * "Chat summary" on the lead page: a small icon in the chat panel's header
 * opens a popup with the customer's chat in two or three sentences, in
 * English, made only when somebody presses the button (each one is a paid
 * AI call). A topic drop-down (with a search box) narrows it to one topic;
 * it opens on the topic summarised last on this lead. Cached translation,
 * "N new messages since", Save as note after the person has read and
 * corrected it, and a thumbs up/down.
 *
 * Server: /api/leads/[id]/summary (lib/ai/lead-summary.ts holds the rules
 * for what is sent to the model and what never is).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Check, ChevronDown, Languages, Loader2, NotebookPen, RefreshCw, Search, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface Summary {
  focus: string
  text: string
  translations: Record<string, string>
  madeAt: string
  messages: number
  feedback: "up" | "down" | null
}
interface Reply { summary: Summary | null; newSince?: number; hasChat?: boolean; languages?: Record<string, string>; lastFocus?: string | null }

const PRESETS: Array<{ key: string; label: string }> = [
  { key: "", label: "Whole chat" },
  { key: "fees", label: "Fees" },
  { key: "dates and schedule", label: "Dates" },
  { key: "documents", label: "Documents" },
  { key: "complaint", label: "Complaint" },
]
const labelFor = (focus: string) => PRESETS.find((p) => p.key === focus)?.label ?? focus

function ago(iso: string, nowMs: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const m = Math.max(0, Math.round((nowMs - t) / 60000))
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} ${d === 1 ? "day" : "days"} ago`
}

interface Props {
  leadId: string
  hasContact: boolean
  /** Agents and above make, translate and save; a viewer only reads. */
  canWork: boolean
  onNoteSaved?: () => void
}

/** The small icon in the chat header; the summary opens in a popup. */
export function LeadSummaryButton(props: Readonly<Props>) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Chat summary"
        title="Chat summary"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,26rem)] gap-0 p-0">
        {/* Mounted only while open: every opening reads the latest state. */}
        {open ? <SummaryPanel {...props} /> : null}
      </PopoverContent>
    </Popover>
  )
}

function SummaryPanel({ leadId, hasContact, canWork, onNoteSaved }: Readonly<Props>) {
  /** null until the server says which topic was summarised last. */
  const [focus, setFocus] = useState<string | null>(null)
  const [data, setData] = useState<Reply | null>(null)
  const [loadedFocus, setLoadedFocus] = useState<string | null>(null)
  const [lang, setLang] = useState("en")
  const [busy, setBusy] = useState<null | "make" | "translate" | "note" | "vote">(null)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")
  const seq = useRef(0)

  const load = useCallback(async (f: string, first = false) => {
    const mine = ++seq.current
    try {
      const res = await apiFetch(`/api/leads/${leadId}/summary?focus=${encodeURIComponent(f)}`, { cache: "no-store" })
      const body = (await res.json()) as Reply
      if (mine !== seq.current) return
      // First opening: go to the topic summarised last, if it was another one.
      if (first && typeof body.lastFocus === "string" && body.lastFocus !== f) {
        setFocus(body.lastFocus)
        return
      }
      setData(body)
      setLoadedFocus(f)
      setFocus(f)
      setNowMs(Date.now())
    } catch (err) {
      if (mine !== seq.current) return
      console.error("[lead summary] load failed:", err)
      setData({ summary: null })
      setLoadedFocus(f)
      setFocus(f)
      toast.error(errorText(err, "Could not load the chat summary."))
    }
  }, [leadId])

  // Opening: ask for the whole chat, which also says the last topic.
  useEffect(() => { if (hasContact) void load("", true) }, [load, hasContact])
  // A topic chosen later (or the last one, from the first answer).
  useEffect(() => { if (focus !== null && focus !== loadedFocus) void load(focus) }, [focus, loadedFocus, load])

  const current = focus ?? ""
  const summary = loadedFocus !== null && loadedFocus === focus ? data?.summary ?? null : null
  const languages = data?.languages ?? {}
  const loading = hasContact && (focus === null || loadedFocus !== focus)
  const shown = summary ? (lang !== "en" && summary.translations[lang]) || summary.text : ""

  async function make() {
    if (busy || !canWork || focus === null) return
    setBusy("make")
    try {
      const res = await apiFetch(`/api/leads/${leadId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus }),
      })
      const body = (await res.json()) as Reply
      seq.current++ // a slower GET for this focus must not overwrite the fresh summary
      setData((d) => ({ ...(d ?? {}), summary: body.summary, newSince: 0 }))
      setLoadedFocus(focus)
      setLang("en")
      setNowMs(Date.now())
    } catch (err) {
      console.error("[lead summary] make failed:", err)
      toast.error(errorText(err, "Could not make a summary."))
    } finally {
      setBusy(null)
    }
  }

  async function chooseLanguage(next: string) {
    setLang(next)
    if (next === "en" || !summary || summary.translations[next] || !canWork) return
    setBusy("translate")
    try {
      const res = await apiFetch(`/api/leads/${leadId}/summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "translate", focus: current, lang: next }),
      })
      const body = (await res.json()) as Reply
      if (body.summary) setData((d) => ({ ...(d ?? {}), summary: body.summary }))
    } catch (err) {
      console.error("[lead summary] translate failed:", err)
      toast.error(errorText(err, "Could not translate the summary."))
      setLang("en")
    } finally {
      setBusy(null)
    }
  }

  async function vote(v: "up" | "down") {
    if (!summary || busy || !canWork) return
    setBusy("vote")
    try {
      const res = await apiFetch(`/api/leads/${leadId}/summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feedback", focus: current, vote: summary.feedback === v ? null : v }),
      })
      const body = (await res.json()) as Reply
      if (body.summary) setData((d) => ({ ...(d ?? {}), summary: body.summary }))
    } catch (err) {
      console.error("[lead summary] feedback failed:", err)
      toast.error(errorText(err, "Could not save your feedback."))
    } finally {
      setBusy(null)
    }
  }

  async function saveNote() {
    const text = (noteDraft ?? "").trim()
    if (!text || busy) return
    setBusy("note")
    try {
      await apiFetch(`/api/leads/${leadId}/summary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_note", focus: current, text }),
      })
      toast.success("Saved as a note on this lead.")
      setNoteDraft(null)
      onNoteSaved?.()
    } catch (err) {
      console.error("[lead summary] save note failed:", err)
      toast.error(errorText(err, "Could not save the note."))
    } finally {
      setBusy(null)
    }
  }

  function pick(f: string) {
    setPickerOpen(false)
    setQuery("")
    setLang("en")
    setNoteDraft(null)
    setFocus(f.trim().toLowerCase().slice(0, 60))
  }

  const q = query.trim().toLowerCase()
  const matches = PRESETS.filter((p) => !q || p.label.toLowerCase().includes(q) || p.key.includes(q))
  const customOffer = q && !PRESETS.some((p) => p.label.toLowerCase() === q || p.key === q) ? q.slice(0, 60) : ""
  const newSince = summary ? data?.newSince ?? 0 : 0
  const focusLabel = labelFor(current)

  return (
    <div className="p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-600">
          <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" /> Chat summary
        </p>
        {summary ? (
          <div className="flex items-center gap-1">
            <label className="sr-only" htmlFor={`sum-lang-${leadId}`}>Summary language</label>
            <span className="relative inline-flex items-center">
              <Languages className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <select id={`sum-lang-${leadId}`} value={lang} onChange={(e) => void chooseLanguage(e.target.value)} disabled={busy === "translate"}
                className="h-7 rounded-lg border border-slate-200 bg-white pl-7 pr-1.5 text-[12px] text-slate-700">
                <option value="en">English</option>
                {Object.entries(languages).map(([code, name]) => (
                  <option key={code} value={code} disabled={!canWork && !summary.translations[code]}>{name}</option>
                ))}
              </select>
            </span>
            {canWork ? (
              <button type="button" onClick={() => void make()} disabled={!!busy} aria-label="Make a fresh summary"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
                {busy === "make" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Topic: a drop-down with a search box. */}
      {hasContact ? (
        <div className="relative mt-2.5">
          <button type="button" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen} aria-haspopup="listbox"
            className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-700 hover:bg-slate-50">
            <span className="truncate"><span className="text-slate-500">Topic: </span><span className="font-semibold">{focus === null ? "…" : focusLabel}</span></span>
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform", pickerOpen && "rotate-180")} aria-hidden="true" />
          </button>
          {pickerOpen ? (
            <div className="absolute left-0 right-0 top-9 z-10 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
              <form onSubmit={(e) => { e.preventDefault(); if (matches.length === 1 && !customOffer) pick(matches[0].key); else if (customOffer) pick(customOffer) }}
                className="relative">
                <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={60} autoComplete="off" name="summary-topic-search"
                  aria-label="Search or type a topic" placeholder="Search or type a topic…"
                  className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </form>
              <ul role="listbox" aria-label="Topics" className="mt-1 max-h-48 overflow-y-auto">
                {matches.map((p) => (
                  <li key={p.key || "all"} role="option" aria-selected={current === p.key}>
                    <button type="button" onClick={() => pick(p.key)}
                      className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-slate-100", current === p.key ? "font-semibold text-slate-900" : "text-slate-700")}>
                      {p.label}
                      {current === p.key ? <Check className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" /> : null}
                    </button>
                  </li>
                ))}
                {!PRESETS.some((p) => p.key === current) && current && !q ? (
                  <li role="option" aria-selected>
                    <span className="flex items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] font-semibold text-slate-900">
                      {current} <Check className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                    </span>
                  </li>
                ) : null}
                {customOffer ? (
                  <li role="option" aria-selected={false}>
                    <button type="button" onClick={() => pick(customOffer)}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-indigo-700 hover:bg-indigo-50">
                      <Search className="h-3.5 w-3.5" aria-hidden="true" /> <span className="truncate">Summarise about “{customOffer}”</span>
                    </button>
                  </li>
                ) : null}
                {matches.length === 0 && !customOffer ? <li className="px-2 py-1.5 text-[12px] text-slate-500">No topic matches.</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3" aria-live="polite">
        {!hasContact ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-[12.5px] text-slate-600">This lead has no contact yet, so there is no chat to summarise.</p>
        ) : loading ? (
          <div className="space-y-2" role="status" aria-label="Loading the summary">
            <div className="h-3 w-11/12 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-9/12 animate-pulse rounded bg-slate-100" />
          </div>
        ) : summary ? (
          <>
            <p className={cn("max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-800", busy === "translate" && "opacity-50")} lang={lang}>
              {shown}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span>{current ? `${focusLabel} · ` : ""}Made {ago(summary.madeAt, nowMs)} from {summary.messages} messages</span>
              {newSince > 0 ? (
                <span className="font-semibold text-amber-700">
                  {newSince} new {newSince === 1 ? "message" : "messages"} since
                  {canWork ? (
                    <button type="button" onClick={() => void make()} disabled={!!busy} className="ml-1.5 underline underline-offset-2 hover:text-amber-900">Refresh</button>
                  ) : null}
                </span>
              ) : null}
              <span>AI can be wrong; check before you act.</span>
            </div>

            {canWork ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setNoteDraft(shown)} disabled={!!busy || noteDraft !== null}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" /> Save as note
                </button>
                <button type="button" onClick={() => void vote("up")} disabled={!!busy} aria-pressed={summary.feedback === "up"} aria-label="Good summary"
                  className={cn("flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100", summary.feedback === "up" ? "text-emerald-700" : "text-slate-400")}>
                  <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => void vote("down")} disabled={!!busy} aria-pressed={summary.feedback === "down"} aria-label="Wrong summary"
                  className={cn("flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100", summary.feedback === "down" ? "text-rose-700" : "text-slate-400")}>
                  <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {noteDraft !== null ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label htmlFor={`sum-note-${leadId}`} className="text-[12px] font-semibold text-slate-700">Check and correct it, then save</label>
                <textarea id={`sum-note-${leadId}`} name="summary-note" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={4} maxLength={2000}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white p-2 text-[13px] text-slate-800" />
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => setNoteDraft(null)} disabled={busy === "note"}
                    className="h-8 rounded-lg px-3 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button type="button" onClick={() => void saveNote()} disabled={busy === "note" || !noteDraft.trim()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {busy === "note" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />} Save note
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : canWork ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
            <p className="min-w-0 text-[12.5px] text-slate-600">
              {data?.hasChat === false ? "No chat with this customer that you can see yet." : current ? `Summarise what the chat says about ${focusLabel.toLowerCase()}.` : "Get the chat in two or three sentences."}
            </p>
            <button type="button" onClick={() => void make()} disabled={!!busy || data?.hasChat === false}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-[13px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy === "make" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              Summarise
            </button>
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-[12.5px] text-slate-600">No summary yet. An agent can make one.</p>
        )}
      </div>
    </div>
  )
}
