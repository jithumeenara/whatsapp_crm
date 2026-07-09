"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, useRef } from "react"
import { toast } from "sonner"
import {
  Radio, Plus, RefreshCw, Send, CheckCircle2, XCircle,
  Eye, MessageCircle, Users, Trash2,
} from "lucide-react"
import type { Broadcast } from "@/types"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

const STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  draft:     { label: "Draft",     dot: "bg-slate-400",  badge: "bg-slate-100 text-slate-600 border-slate-200" },
  scheduled: { label: "Scheduled", dot: "bg-sky-500",    badge: "bg-sky-50 text-sky-700 border-sky-200" },
  sending:   { label: "Sending",   dot: "bg-indigo-500 animate-pulse", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  sent:      { label: "Sent",      dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  failed:    { label: "Failed",    dot: "bg-rose-500",    badge: "bg-rose-50 text-rose-700 border-rose-200" },
}

function DeliveryRing({ pct, color }: { pct: number; color: string }) {
  const r = 18; const c = 2 * Math.PI * r
  return (
    <svg className="h-11 w-11 -rotate-90" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" stroke="#f1f5f9" />
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" stroke={color}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        strokeLinecap="round" className="transition-all duration-700" />
    </svg>
  )
}

export default function BroadcastsV2() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetch("/api/broadcasts").then((r) => r.json())
      setBroadcasts(Array.isArray(data) ? data : (data?.broadcasts ?? []))
    } catch {
      toast.error("Failed to load broadcasts")
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm("Delete this broadcast? This cannot be undone.")) return
    setDeleting((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/broadcasts/${id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Delete failed")
      setBroadcasts((prev) => prev.filter((b) => b.id !== id))
      toast.success("Broadcast deleted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setDeleting((prev) => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  useEffect(() => {
    load()
    pollRef.current = setInterval(() => {
      setBroadcasts((prev) => {
        if (prev.some((b) => b.status === "sending")) load()
        return prev
      })
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  return (
    <div className="flex h-full flex-col bg-[#F4F6FA]">

      {/* â”€â”€ Header â”€â”€ */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-sm">
              <Radio className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900 leading-tight">Broadcasts</h1>
              <p className="text-[12px] text-slate-500 leading-tight">
                {loading ? "Loading…" : `${broadcasts.length} total`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={load}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <Link href="/broadcasts/new"
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 shadow-sm transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Broadcast
            </Link>
          </div>
        </div>
      </div>

      {/* â”€â”€ Content â”€â”€ */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-2xl bg-white border border-slate-200 p-5 h-[130px] animate-pulse" />
            ))}
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white border border-slate-200 shadow-sm mb-5">
              <Radio className="h-8 w-8 text-slate-300" />
            </div>
            <p className="text-[15px] font-semibold text-slate-700">No broadcasts yet</p>
            <p className="mt-1 text-[13px] text-slate-400 max-w-xs">
              Send a WhatsApp template message to multiple contacts at once.
            </p>
            <Link href="/broadcasts/new"
              className="mt-5 flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-indigo-700 shadow-sm transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Broadcast
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {broadcasts.map((b) => {
              const cfg = STATUS[b.status] ?? STATUS.draft
              const readPct = b.total_recipients > 0 ? Math.round((b.read_count / b.total_recipients) * 100) : 0
              const delivPct = b.total_recipients > 0 ? Math.round((b.delivered_count / b.total_recipients) * 100) : 0
              const sentPct = b.total_recipients > 0 ? Math.round((b.sent_count / b.total_recipients) * 100) : 0
              const isSending = b.status === "sending"

              return (
                <Link key={b.id} href={`/broadcasts/${b.id}`} className="group block">
                  <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:border-indigo-100 transition-all p-5">
                    <div className="flex items-start gap-4">
                      {/* Ring graphic */}
                      <div className="shrink-0 relative">
                        <DeliveryRing pct={readPct} color="#6366f1" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[10px] font-bold text-slate-700">{readPct}%</span>
                        </div>
                      </div>

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="text-[14px] font-semibold text-slate-900 truncate leading-snug">{b.name}</p>
                            <p className="text-[12px] text-slate-400 truncate mt-0.5">{b.template_name}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", cfg.badge)}>
                              <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                              {cfg.label}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleDelete(e, b.id)}
                              disabled={deleting.has(b.id) || b.status === "sending"}
                              title={b.status === "sending" ? "Cannot delete while sending" : "Delete broadcast"}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Sending progress bar */}
                        {isSending && (
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                              <span>Sending…</span>
                              <span>{sentPct}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${sentPct}%` }} />
                            </div>
                          </div>
                        )}

                        {/* Stats row */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                          <span className="flex items-center gap-1 text-slate-500">
                            <Users className="h-3.5 w-3.5 text-slate-300" />
                            <span className="font-semibold text-slate-700">{b.total_recipients.toLocaleString()}</span>
                            <span>recipients</span>
                          </span>
                          <span className="flex items-center gap-1 text-slate-500">
                            <Send className="h-3.5 w-3.5 text-indigo-300" />
                            <span className="font-semibold text-indigo-600">{b.sent_count.toLocaleString()}</span>
                            <span>sent</span>
                          </span>
                          <span className="flex items-center gap-1 text-slate-500">
                            <CheckCircle2 className="h-3.5 w-3.5 text-teal-300" />
                            <span className="font-semibold text-teal-600">{b.delivered_count.toLocaleString()}</span>
                            <span>delivered</span>
                          </span>
                          <span className="flex items-center gap-1 text-slate-500">
                            <Eye className="h-3.5 w-3.5 text-sky-300" />
                            <span className="font-semibold text-sky-600">{b.read_count.toLocaleString()}</span>
                            <span>read</span>
                          </span>
                          {b.replied_count > 0 && (
                            <span className="flex items-center gap-1 text-slate-500">
                              <MessageCircle className="h-3.5 w-3.5 text-violet-300" />
                              <span className="font-semibold text-violet-600">{b.replied_count.toLocaleString()}</span>
                              <span>replied</span>
                            </span>
                          )}
                          {b.failed_count > 0 && (
                            <span className="flex items-center gap-1 text-slate-500">
                              <XCircle className="h-3.5 w-3.5 text-rose-300" />
                              <span className="font-semibold text-rose-600">{b.failed_count.toLocaleString()}</span>
                              <span>failed</span>
                            </span>
                          )}
                          <span className="ml-auto text-[11px] text-slate-400">
                            {new Date(b.created_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        </div>

                        {/* Delivery progress strip (non-sending) */}
                        {!isSending && b.total_recipients > 0 && (
                          <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-slate-100 flex gap-px">
                            <div className="bg-sky-400 rounded-l-full transition-all" style={{ width: `${Math.max(0, delivPct - readPct)}%` }} />
                            <div className="bg-indigo-500 transition-all" style={{ width: `${readPct}%` }} />
                            {b.failed_count > 0 && (
                              <div className="bg-rose-400 rounded-r-full transition-all" style={{ width: `${Math.round((b.failed_count / b.total_recipients) * 100)}%` }} />
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
      </div>
    </div>
  )
}
