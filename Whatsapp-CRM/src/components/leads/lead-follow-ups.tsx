"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Bell, CalendarClock, Check, ChevronDown, Loader2, PhoneOff, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface LeadFollowUp {
  id: string
  title: string
  note: string | null
  due_at: string
  status: string // pending | done | skipped
  completed_at?: string | null
}

type Outcome = "done" | "rescheduled" | "not_reached"

const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none"

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  })
}

function localParts(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function tomorrowSameTime(iso: string) {
  const d = new Date(iso)
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(d.getHours(), d.getMinutes(), 0, 0)
  return localParts(next)
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  done: { label: "Done", cls: "bg-emerald-50 text-emerald-700" },
  skipped: { label: "Couldn’t reach", cls: "bg-rose-50 text-rose-700" },
}

/**
 * The lead's scheduled calls, and what happened to each.
 *
 * Open ones first, each with the three things that happen to a call:
 * Done, Reschedule, Couldn't reach. Closed ones below, folded away.
 */
export function LeadFollowUps({
  items, onChanged, unclaimed = false,
}: {
  items: LeadFollowUp[]
  onChanged: () => void
  /** Nobody holds this lead: acting on a follow-up picks it up. */
  unclaimed?: boolean
}) {
  const [active, setActive] = useState<{ id: string; outcome: Outcome } | null>(null)
  const [note, setNote] = useState("")
  const [next, setNext] = useState({ date: "", time: "" })
  const [retry, setRetry] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPast, setShowPast] = useState(false)

  const open = items.filter((f) => f.status === "pending").sort((a, b) => a.due_at.localeCompare(b.due_at))
  const past = items.filter((f) => f.status !== "pending").sort((a, b) => b.due_at.localeCompare(a.due_at))
  if (items.length === 0) return null

  function start(f: LeadFollowUp, outcome: Outcome) {
    setActive({ id: f.id, outcome })
    setNote("")
    setNext(tomorrowSameTime(f.due_at))
    setRetry(false)
  }

  async function submit() {
    if (!active) return
    const needsTime = active.outcome === "rescheduled" || (active.outcome === "not_reached" && retry)
    let nextAt: string | undefined
    if (needsTime) {
      const d = new Date(`${next.date}T${next.time}`)
      if (Number.isNaN(d.getTime())) { toast.error("Choose a date and time"); return }
      nextAt = d.toISOString()
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/follow-ups/${active.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: active.outcome, note: note.trim() || undefined, next_at: nextAt }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? "Could not save"); return }
      toast.success(
        active.outcome === "done" ? "Marked done"
          : active.outcome === "rescheduled" ? "Rescheduled"
          : retry ? "Saved — we'll remind you to try again" : "Saved as couldn’t reach",
      )
      setActive(null)
      onChanged()
    } catch {
      toast.error("Could not save")
    } finally {
      setSaving(false)
    }
  }

  const today = localParts(new Date()).date

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
        <Bell className="h-3.5 w-3.5 text-orange-500" /> Follow-ups
      </p>

      {open.length === 0 && (
        <p className="text-[13px] text-slate-400 italic mb-2">No follow-up waiting.</p>
      )}

      {unclaimed && open.length > 0 && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-[12px] text-sky-800">
          Nobody has picked this lead yet. Marking a follow-up done, rescheduling it or recording that you
          couldn&apos;t reach them picks the lead up for you.
        </p>
      )}

      <div className="space-y-3">
        {open.map((f) => {
          const overdue = new Date(f.due_at).getTime() < Date.now()
          const isActive = active?.id === f.id
          return (
            <div key={f.id} className={cn("rounded-xl border p-3", overdue ? "border-rose-200 bg-rose-50/40" : "border-slate-200")}>
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn("text-[13px] font-semibold", overdue ? "text-rose-700" : "text-slate-800")}>
                  {when(f.due_at)}
                </p>
                {overdue && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Overdue</span>}
              </div>
              {f.note && <p className="mt-1 text-[12px] text-slate-600 whitespace-pre-wrap break-words">{f.note}</p>}

              {!isActive ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => start(f, "done")}
                    className="flex items-center gap-1 h-8 px-3 rounded-lg bg-emerald-600 text-[12px] font-semibold text-white hover:bg-emerald-700">
                    <Check className="h-3.5 w-3.5" /> Done
                  </button>
                  <button type="button" onClick={() => start(f, "rescheduled")}
                    className="flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                    <CalendarClock className="h-3.5 w-3.5" /> Reschedule
                  </button>
                  <button type="button" onClick={() => start(f, "not_reached")}
                    className="flex items-center gap-1 h-8 px-3 rounded-lg border border-rose-200 text-[12px] font-semibold text-rose-600 hover:bg-rose-50">
                    <PhoneOff className="h-3.5 w-3.5" /> Couldn&apos;t reach
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2.5 rounded-lg bg-slate-50 p-3">
                  <p className="text-[12px] font-semibold text-slate-700">
                    {active.outcome === "done" ? "Mark as done" : active.outcome === "rescheduled" ? "Move to a new time" : "Couldn’t reach the customer"}
                  </p>

                  {active.outcome === "not_reached" && (
                    <label className="flex items-center gap-2 text-[12px] text-slate-700">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={retry} onChange={(e) => setRetry(e.target.checked)} />
                      Remind me to try again
                    </label>
                  )}

                  {(active.outcome === "rescheduled" || (active.outcome === "not_reached" && retry)) && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`fu-${f.id}-date`} className="block text-[11px] font-medium text-slate-600 mb-1">Date</label>
                        <input id={`fu-${f.id}-date`} type="date" min={today} className={INPUT}
                          value={next.date} onChange={(e) => setNext((n) => ({ ...n, date: e.target.value }))} />
                      </div>
                      <div>
                        <label htmlFor={`fu-${f.id}-time`} className="block text-[11px] font-medium text-slate-600 mb-1">Time</label>
                        <input id={`fu-${f.id}-time`} type="time" className={INPUT}
                          value={next.time} onChange={(e) => setNext((n) => ({ ...n, time: e.target.value }))} />
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor={`fu-${f.id}-note`} className="block text-[11px] font-medium text-slate-600 mb-1">
                      {active.outcome === "done" ? "What was discussed (optional)" : active.outcome === "rescheduled" ? "Reason (optional)" : "What happened (optional)"}
                    </label>
                    <textarea id={`fu-${f.id}-note`} rows={2} maxLength={1000} className={INPUT + " resize-none"}
                      placeholder={active.outcome === "done" ? "e.g. Explained fees, will visit on Monday"
                        : active.outcome === "rescheduled" ? "e.g. Customer busy, asked to call in the evening"
                        : "e.g. Switched off / no answer / busy"}
                      value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setActive(null)} disabled={saving}
                      className="flex items-center gap-1 h-8 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:bg-slate-50">
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                    <button type="button" onClick={submit} disabled={saving}
                      className="flex items-center gap-1 h-8 px-3 rounded-lg bg-indigo-600 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {past.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowPast((v) => !v)}
            className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-700">
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showPast && "rotate-180")} />
            Earlier ({past.length})
          </button>
          {showPast && (
            <ul className="mt-2 space-y-1.5">
              {past.map((f) => {
                const chip = STATUS_CHIP[f.status] ?? { label: f.status, cls: "bg-slate-100 text-slate-600" }
                return (
                  <li key={f.id} className="flex items-center gap-2 text-[12px] text-slate-600">
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", chip.cls)}>{chip.label}</span>
                    <span className="truncate">{when(f.due_at)}{f.note ? ` — ${f.note}` : ""}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
