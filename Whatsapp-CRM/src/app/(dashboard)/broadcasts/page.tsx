"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useMemo } from "react"
import { toast } from "sonner"
import {
  Radio, Plus, RefreshCw, Send, CheckCircle2, XCircle,
  Eye, MessageCircle, Users, Trash2, Repeat, CalendarClock, CornerDownRight, Hourglass,
} from "lucide-react"
import type { Broadcast } from "@/types"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { EventBroadcasts, waitText } from "@/components/broadcasts/event-broadcasts"
import { ListsManager } from "@/components/broadcasts/lists-manager"
import { BroadcastRules } from "@/components/broadcasts/broadcast-rules"
import { useConfirm } from "@/hooks/use-confirm"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { everyWhileVisible } from "@/lib/visible-interval"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const TABS = ["campaigns", "events", "lists", "rules"] as const
type Tab = typeof TABS[number]

const STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  draft:     { label: "Draft",     dot: "bg-slate-400",  badge: "bg-slate-100 text-slate-600 border-slate-200" },
  scheduled: { label: "Scheduled", dot: "bg-sky-500",    badge: "bg-sky-50 text-sky-700 border-sky-200" },
  sending:   { label: "Sending",   dot: "bg-indigo-500 animate-pulse", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  sent:      { label: "Sent",      dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  failed:    { label: "Failed",    dot: "bg-rose-500",    badge: "bg-rose-50 text-rose-700 border-rose-200" },
  waiting:   { label: "Waiting",   dot: "bg-sky-500",     badge: "bg-sky-50 text-sky-700 border-sky-200" },
  cancelled: { label: "Cancelled", dot: "bg-slate-400",   badge: "bg-slate-100 text-slate-600 border-slate-200" },
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

function DeliveryRing({ pct, color }: { pct: number; color: string }) {
  const r = 18; const c = 2 * Math.PI * r
  return (
    <svg className="h-11 w-11 -rotate-90" viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" stroke="#f1f5f9" />
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" stroke={color}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        strokeLinecap="round" className="transition-[stroke-dashoffset] duration-700" />
    </svg>
  )
}

export default function BroadcastsV2() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<Tab>("campaigns")
  const confirm = useConfirm()

  // The tab lives in the address (?tab=lists), so a link or a reload
  // opens the same one.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab")
    if (t && (TABS as readonly string[]).includes(t)) setTab(t as Tab)
  }, [])
  function changeTab(t: Tab) {
    setTab(t)
    const url = new URL(window.location.href)
    if (t === "campaigns") url.searchParams.delete("tab")
    else url.searchParams.set("tab", t)
    window.history.replaceState(null, "", url)
  }

  const load = useCallback(async () => {
    try {
      const data = await apiFetch("/api/broadcasts").then((r) => r.json())
      setBroadcasts(Array.isArray(data) ? data : (data?.broadcasts ?? []))
    } catch (err) {
      console.error("[broadcasts] load failed:", err)
      toast.error(errorText(err, "Failed to load broadcasts"))
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    const ok = await confirm({
      title: "Delete this broadcast?",
      description: "Its report and recipient list go with it. This cannot be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
    })
    if (!ok) return
    setDeleting((prev) => new Set(prev).add(id))
    try {
      await apiFetch(`/api/broadcasts/${id}`, { method: "DELETE" })
      setBroadcasts((prev) => prev.filter((b) => b.id !== id))
      toast.success("Broadcast deleted")
    } catch (err) {
      console.error("[broadcasts] delete failed:", err)
      toast.error(errorText(err, "Delete failed"))
    } finally {
      setDeleting((prev) => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  useEffect(() => { void load() }, [load])
  // Refresh while something is sending; rests while the tab is hidden.
  const anySending = broadcasts.some((b) => b.status === "sending")
  useEffect(() => {
    if (!anySending) return
    return everyWhileVisible(() => { void load() }, 5000)
  }, [anySending, load])

  const campaigns = useMemo(() => broadcasts.filter((b) => b.schedule_type !== "event"), [broadcasts])
  const events = useMemo(() => broadcasts.filter((b) => b.schedule_type === "event"), [broadcasts])

  return (
    <div className="flex h-full flex-col bg-[#F4F6FA]">

      {/* ── Header ── */}
      <div className="shrink-0 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-sm">
              <Radio className="h-4.5 w-4.5 text-white" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-[16px] font-bold text-slate-900 leading-tight">Broadcasts</h1>
              <p className="text-[12px] text-slate-500 leading-tight">
                {loading ? "Loading…" : <>{campaigns.length} campaigns<span className="hidden sm:inline"> · {events.length} event-based</span></>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => void load()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
            </button>
            <Link href="/broadcasts/new"
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 shadow-sm transition-colors sm:px-4">
              <Plus className="h-3.5 w-3.5" aria-hidden /> New broadcast
            </Link>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-4 sm:px-6">
          <TabsList variant="line" className="h-10">
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="events">Event-based</TabsTrigger>
            <TabsTrigger value="lists">Lists</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="events" className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? <div className="h-32 animate-pulse rounded-xl bg-white" aria-hidden /> : (
            <EventBroadcasts items={events} onChanged={(c) => setBroadcasts((prev) => prev.map((b) => (b.id === c.id ? { ...b, status: c.status } : b)))} />
          )}
        </TabsContent>
        <TabsContent value="lists" className="flex-1 overflow-y-auto p-4 sm:p-6"><ListsManager /></TabsContent>
        <TabsContent value="rules" className="flex-1 overflow-y-auto p-4 sm:p-6"><BroadcastRules /></TabsContent>

        <TabsContent value="campaigns" className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-2xl bg-white border border-slate-200 p-5 h-[130px] animate-pulse" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white border border-slate-200 shadow-sm mb-5">
                <Radio className="h-8 w-8 text-slate-300" aria-hidden />
              </div>
              <p className="text-[15px] font-semibold text-slate-700">No broadcasts yet</p>
              <p className="mt-1 text-[13px] text-slate-500 max-w-xs">
                Send a WhatsApp template message to multiple contacts at once.
              </p>
              <Link href="/broadcasts/new"
                className="mt-5 flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700 shadow-sm transition-colors">
                <Plus className="h-3.5 w-3.5" aria-hidden /> New broadcast
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((b) => {
                const cfg = STATUS[b.status] ?? STATUS.draft
                const readPct = b.total_recipients > 0 ? Math.round((b.read_count / b.total_recipients) * 100) : 0
                const delivPct = b.total_recipients > 0 ? Math.round((b.delivered_count / b.total_recipients) * 100) : 0
                const sentPct = b.total_recipients > 0 ? Math.round((b.sent_count / b.total_recipients) * 100) : 0
                const isSending = b.status === "sending"

                return (
                  <Link key={b.id} href={`/broadcasts/${b.id}`} className="group block">
                    <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:border-indigo-100 transition-[box-shadow,border-color] p-4 sm:p-5">
                      <div className="flex items-start gap-3 sm:gap-4">
                        <div className="shrink-0 relative">
                          <DeliveryRing pct={readPct} color="#6366f1" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-slate-700">{readPct}%</span>
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="text-[14px] font-semibold text-slate-900 truncate leading-snug">{b.name}</p>
                              <p className="text-[12px] text-slate-500 truncate mt-0.5">{b.template_name}</p>
                              {b.parent && (
                                <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-indigo-700">
                                  <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
                                  Follow-up to “{b.parent.name}”
                                </p>
                              )}
                              {b.status === "waiting" && (
                                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-sky-700">
                                  <Hourglass className="h-3 w-3 shrink-0" aria-hidden />
                                  Goes {b.follow_up_delay_minutes ? `${waitText(b.follow_up_delay_minutes)} after` : "as soon as"} the first broadcast finishes
                                </p>
                              )}
                              {b.status === "scheduled" && b.next_send_at && (
                                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-sky-700">
                                  <CalendarClock className="h-3 w-3" aria-hidden />
                                  {dateTimeFmt.format(new Date(b.next_send_at))}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {b.schedule_type === "recurring" && (
                                <span title={`Repeats · ${b.sends_count ?? 0}/${b.max_sends ?? 1} sent`}
                                  className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                  <Repeat className="h-3 w-3" aria-hidden /> {b.sends_count ?? 0}/{b.max_sends ?? 1}
                                </span>
                              )}
                              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", cfg.badge)}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                                {cfg.label}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => void handleDelete(e, b.id)}
                                disabled={deleting.has(b.id) || b.status === "sending"}
                                title={b.status === "sending" ? "Cannot delete while sending" : "Delete broadcast"}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 opacity-100 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-rose-50 hover:text-rose-600 transition-[opacity,background-color,color] disabled:opacity-20 disabled:cursor-not-allowed"
                                aria-label={b.status === "sending" ? "Cannot delete while sending" : "Delete broadcast"}>
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                          </div>

                          {isSending && (
                            <div className="mb-3">
                              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                <span>Sending…</span>
                                <span>{sentPct}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${sentPct}%` }} />
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] tabular-nums">
                            <span className="flex items-center gap-1 text-slate-500">
                              <Users className="h-3.5 w-3.5 text-slate-300" aria-hidden />
                              <span className="font-semibold text-slate-700">{b.total_recipients.toLocaleString()}</span>
                              <span>recipients</span>
                            </span>
                            <span className="flex items-center gap-1 text-slate-500">
                              <Send className="h-3.5 w-3.5 text-indigo-300" aria-hidden />
                              <span className="font-semibold text-indigo-600">{b.sent_count.toLocaleString()}</span>
                              <span>sent</span>
                            </span>
                            <span className="flex items-center gap-1 text-slate-500">
                              <CheckCircle2 className="h-3.5 w-3.5 text-teal-300" aria-hidden />
                              <span className="font-semibold text-teal-700">{b.delivered_count.toLocaleString()}</span>
                              <span>delivered</span>
                            </span>
                            <span className="flex items-center gap-1 text-slate-500">
                              <Eye className="h-3.5 w-3.5 text-sky-300" aria-hidden />
                              <span className="font-semibold text-sky-700">{b.read_count.toLocaleString()}</span>
                              <span>read</span>
                            </span>
                            {b.replied_count > 0 && (
                              <span className="flex items-center gap-1 text-slate-500">
                                <MessageCircle className="h-3.5 w-3.5 text-violet-300" aria-hidden />
                                <span className="font-semibold text-violet-600">{b.replied_count.toLocaleString()}</span>
                                <span>replied</span>
                              </span>
                            )}
                            {b.failed_count > 0 && (
                              <span className="flex items-center gap-1 text-slate-500">
                                <XCircle className="h-3.5 w-3.5 text-rose-300" aria-hidden />
                                <span className="font-semibold text-rose-700">{b.failed_count.toLocaleString()}</span>
                                <span>failed</span>
                              </span>
                            )}
                            <span className="ml-auto text-[11px] text-slate-500">
                              {dateFmt.format(new Date(b.created_at))}
                            </span>
                          </div>

                          {!isSending && b.total_recipients > 0 && (
                            <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-slate-100 flex gap-px">
                              <div className="bg-sky-400 rounded-l-full transition-[width]" style={{ width: `${Math.max(0, delivPct - readPct)}%` }} />
                              <div className="bg-indigo-500 transition-[width]" style={{ width: `${readPct}%` }} />
                              {b.failed_count > 0 && (
                                <div className="bg-rose-400 rounded-r-full transition-[width]" style={{ width: `${Math.round((b.failed_count / b.total_recipients) * 100)}%` }} />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
