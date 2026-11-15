"use client"

/**
 * Reports → Scheduled (phase F1): reports sent on a schedule to team
 * members by Admin Chat (WhatsApp / Telegram) and/or email with the PDF.
 * Owners and admins. The server checks everything again; this screen only
 * offers what makes sense (supervisors and above, admins for money ones).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { CalendarClock, Loader2, Mail, MessageCircle, Pause, Play, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useConfirm } from "@/hooks/use-confirm"
import { cn } from "@/lib/utils"

interface Schedule {
  id: string; report_key: string; frequency: "daily" | "weekly" | "monthly"; day: number; send_hour: number
  recipient_ids: string[]; by_chat: boolean; by_email: boolean; enabled: boolean; last_sent_at: string | null; last_result: string | null
}
interface Member { id: string; name: string; role: string; chat: boolean; email: boolean }
interface Data { schedules: Schedule[]; reports: Array<{ key: string; title: string }>; team: Member[] }

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const RANK: Record<string, number> = { viewer: 0, agent: 1, supervisor: 2, admin: 3, owner: 4 }
const MONEY = new Set(["ads"])
const hourText = (h: number) => `${String(h).padStart(2, "0")}:00`
const may = (reportKey: string, role: string) => (RANK[role] ?? 0) >= (MONEY.has(reportKey) ? 3 : 2)

function whenText(s: Pick<Schedule, "frequency" | "day" | "send_hour">): string {
  if (s.frequency === "daily") return `Every day at ${hourText(s.send_hour)} (yesterday's numbers)`
  if (s.frequency === "weekly") return `Every ${DAYS[s.day - 1] ?? "Monday"} at ${hourText(s.send_hour)} (last week)`
  return `On day ${s.day} of each month at ${hourText(s.send_hour)} (last month)`
}

const BLANK = { report_key: "all", frequency: "weekly" as Schedule["frequency"], day: 1, send_hour: 9, recipient_ids: [] as string[], by_chat: true, by_email: false }

export function ScheduledReports() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const savingRef = useRef(false)
  const loadSeq = useRef(0)
  const confirm = useConfirm()

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const res = await apiFetch("/api/reports/schedules", { cache: "no-store" })
      const body = (await res.json()) as Data
      if (seq !== loadSeq.current) return
      setData({ schedules: Array.isArray(body?.schedules) ? body.schedules : [], reports: Array.isArray(body?.reports) ? body.reports : [], team: Array.isArray(body?.team) ? body.team : [] })
      setError(null)
    } catch (err) {
      if (seq !== loadSeq.current) return
      console.error("[scheduled-reports] load failed", err)
      setError(errorText(err, "Could not load the scheduled reports."))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const eligible = (data?.team ?? []).filter((m) => may(form.report_key, m.role))
  const title = (key: string) => data?.reports.find((r) => r.key === key)?.title ?? key
  const name = (id: string) => data?.team.find((m) => m.id === id)?.name ?? "Former member"

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await apiFetch("/api/reports/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
      toast.success("Scheduled.")
      setForm({ ...BLANK, recipient_ids: [] })
      await load()
    } catch (err) {
      console.error("[scheduled-reports] add failed", err)
      toast.error(errorText(err, "Could not save the schedule."))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function act(s: Schedule, kind: "toggle" | "send" | "delete") {
    if (busy) return
    if (kind === "delete" && !(await confirm({ title: "Stop sending this report?", description: `${title(s.report_key)} will no longer be sent.`, confirmLabel: "Delete", variant: "destructive" }))) return
    setBusy(`${s.id}:${kind}`)
    try {
      if (kind === "toggle") {
        await apiFetch(`/api/reports/schedules/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) })
        toast.success(s.enabled ? "Paused." : "Sending again.")
      } else if (kind === "send") {
        const res = await apiFetch(`/api/reports/schedules/${s.id}/send`, { method: "POST" })
        const body = (await res.json()) as { result?: string }
        toast.success(body?.result || "Sent.")
      } else {
        await apiFetch(`/api/reports/schedules/${s.id}`, { method: "DELETE" })
        toast.success("Deleted.")
      }
      await load()
    } catch (err) {
      console.error("[scheduled-reports] action failed", err)
      toast.error(errorText(err, "That did not work. Try again."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl min-w-0 space-y-5">
      <header className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15" aria-hidden>
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-balance text-[20px] font-bold leading-tight text-slate-900">Scheduled reports</h1>
          <p className="mt-0.5 text-pretty text-[13px] text-slate-600">Sent to your team on WhatsApp or Telegram (Admin Chat) and by email with the PDF.</p>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-[13px] text-rose-700">
          {error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button>
        </div>
      )}

      {data === null && !error ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>
      ) : data && (
        <>
          <section aria-labelledby="sched-list" className="space-y-2">
            <h2 id="sched-list" className="text-[14px] font-semibold text-slate-800">Sending now</h2>
            {data.schedules.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-[13px] text-slate-500">Nothing is scheduled yet. Add one below.</p>
            ) : (
              <ul className="space-y-2">
                {data.schedules.map((s) => (
                  <li key={s.id} className={cn("min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-card", !s.enabled && "opacity-70")}>
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-[14px] font-semibold text-slate-800">{title(s.report_key)}{!s.enabled && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Paused</span>}</p>
                        <p className="mt-0.5 text-[12.5px] text-slate-600">{whenText(s)}</p>
                        <p className="mt-1 break-words text-[12.5px] text-slate-600">
                          To {s.recipient_ids.map(name).join(", ")} · {[s.by_chat && "WhatsApp/Telegram", s.by_email && "email"].filter(Boolean).join(" and ")}
                        </p>
                        {s.last_result && <p className="mt-1 break-words text-[12px] text-slate-500">Last: {s.last_result}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act(s, "send")}>
                          {busy === `${s.id}:send` ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}{busy === `${s.id}:send` ? "Sending…" : "Send now"}
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act(s, "toggle")}>
                          {s.enabled ? <Pause aria-hidden /> : <Play aria-hidden />}{s.enabled ? "Pause" : "Resume"}
                        </Button>
                        <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void act(s, "delete")} aria-label={`Delete ${title(s.report_key)} schedule`}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form onSubmit={add} aria-labelledby="sched-add" className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
            <h2 id="sched-add" className="text-[14px] font-semibold text-slate-800">Add a scheduled report</h2>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-[12.5px] font-medium text-slate-600">Report
                <select name="report" value={form.report_key} onChange={(e) => setForm({ ...form, report_key: e.target.value, recipient_ids: [] })} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                  {data.reports.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-[12.5px] font-medium text-slate-600">How often
                <select name="frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Schedule["frequency"], day: 1 })} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                  <option value="daily">Every day (yesterday)</option>
                  <option value="weekly">Every week (last week)</option>
                  <option value="monthly">Every month (last month)</option>
                </select>
              </label>
              {form.frequency !== "daily" && (
                <label className="min-w-0 text-[12.5px] font-medium text-slate-600">{form.frequency === "weekly" ? "Day of the week" : "Day of the month"}
                  <select name="day" value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                    {(form.frequency === "weekly" ? DAYS.map((d, i) => ({ v: i + 1, t: d })) : Array.from({ length: 28 }, (_, i) => ({ v: i + 1, t: String(i + 1) }))).map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                  </select>
                </label>
              )}
              <label className="min-w-0 text-[12.5px] font-medium text-slate-600">Time (business time)
                <select name="hour" value={form.send_hour} onChange={(e) => setForm({ ...form, send_hour: Number(e.target.value) })} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourText(h)}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="min-w-0">
              <legend className="text-[12.5px] font-medium text-slate-600">Send to</legend>
              {eligible.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-slate-500">Nobody on the team may see this report for the whole team.</p>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {eligible.map((m) => {
                    const on = form.recipient_ids.includes(m.id)
                    return (
                      <label key={m.id} className={cn("inline-flex h-9 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-full border px-3 text-[12.5px]", on ? "border-primary/40 bg-primary/10 text-primary" : "border-slate-200 bg-white text-slate-700")}>
                        <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--primary)]" checked={on} onChange={() => setForm({ ...form, recipient_ids: on ? form.recipient_ids.filter((x) => x !== m.id) : [...form.recipient_ids, m.id] })} />
                        <span className="min-w-0 truncate" title={m.name}>{m.name}</span>
                        <span className="sr-only">{m.chat ? ", on Admin Chat" : ", not on Admin Chat"}</span>
                        {m.chat ? <MessageCircle className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
                        {m.email ? <Mail className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="mt-1.5 text-[12px] text-slate-500">WhatsApp/Telegram reaches only people set up in Admin Chat. Outside WhatsApp&apos;s 24-hour window it uses your approved brief template.</p>
            </fieldset>

            <fieldset className="flex min-w-0 flex-wrap gap-4">
              <legend className="sr-only">How</legend>
              <label className="inline-flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" className="h-4 w-4" checked={form.by_chat} onChange={(e) => setForm({ ...form, by_chat: e.target.checked })} />WhatsApp / Telegram</label>
              <label className="inline-flex items-center gap-2 text-[13px] text-slate-700"><input type="checkbox" className="h-4 w-4" checked={form.by_email} onChange={(e) => setForm({ ...form, by_email: e.target.checked })} />Email with the PDF</label>
            </fieldset>

            <Button type="submit" disabled={saving || form.recipient_ids.length === 0 || (!form.by_chat && !form.by_email)}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarClock aria-hidden />}{saving ? "Saving…" : "Schedule it"}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}
