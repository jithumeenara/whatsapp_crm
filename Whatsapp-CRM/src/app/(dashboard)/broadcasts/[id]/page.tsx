"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Users, CheckCircle2, XCircle, AlertCircle,
  Eye, MessageCircle, Send, Search, Clock, RefreshCw, FileText, Radio, Download,
  Square, RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import { format, formatDistanceToNow } from "date-fns"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

interface Broadcast {
  id: string
  name: string
  status: string
  template_name: string
  template_language?: string
  audience_filter?: Record<string, unknown>
  created_at: string
  scheduled_at?: string
  total_recipients: number
  sent_count: number
  delivered_count: number
  read_count: number
  replied_count: number
  failed_count: number
}

interface Recipient {
  id: string
  status: string
  sent_at?: string | null
  delivered_at?: string | null
  read_at?: string | null
  replied_at?: string | null
  error_message?: string | null
  contact?: {
    id: string
    name?: string | null
    phone: string
    email?: string | null
  } | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending:   { label: "Pending",   color: "text-slate-500",   bg: "bg-slate-100",   icon: Clock },
  sent:      { label: "Sent",      color: "text-blue-600",    bg: "bg-blue-50",     icon: Send },
  delivered: { label: "Delivered", color: "text-indigo-600",  bg: "bg-indigo-50",   icon: CheckCircle2 },
  read:      { label: "Read",      color: "text-emerald-600", bg: "bg-emerald-50",  icon: Eye },
  replied:   { label: "Replied",   color: "text-violet-600",  bg: "bg-violet-50",   icon: MessageCircle },
  failed:    { label: "Failed",    color: "text-rose-600",    bg: "bg-rose-50",     icon: XCircle },
}

const BROADCAST_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: "Draft",      color: "text-slate-600",   bg: "bg-slate-100" },
  scheduled:  { label: "Scheduled",  color: "text-amber-700",   bg: "bg-amber-100" },
  sending:    { label: "Sending…",   color: "text-blue-700",    bg: "bg-blue-100" },
  cancelling: { label: "Stopping…",  color: "text-orange-700",  bg: "bg-orange-100" },
  cancelled:  { label: "Stopped",    color: "text-slate-600",   bg: "bg-slate-100" },
  sent:       { label: "Sent",       color: "text-emerald-700", bg: "bg-emerald-100" },
  failed:     { label: "Failed",     color: "text-rose-700",    bg: "bg-rose-100" },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = BROADCAST_STATUS_CONFIG[status] ?? BROADCAST_STATUS_CONFIG.draft
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize", cfg.bg, cfg.color)}>
      {cfg.label}
    </span>
  )
}

function RecipientStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", cfg.bg, cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, color, sub }: {
  icon: React.ElementType; label: string; value: number; color: string; sub?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-[22px] font-bold text-slate-800 leading-none">{value.toLocaleString()}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-slate-300">{sub}</p>}
      </div>
    </div>
  )
}

const FILTER_TABS = ["all", "sent", "delivered", "read", "replied", "failed", "pending"] as const
type FilterTab = typeof FILTER_TABS[number]

export default function BroadcastDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState("")
  const [filterTab, setFilterTab] = useState<FilterTab>("all")
  const [exporting, setExporting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [retrying, setRetrying] = useState(false)

  async function load(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch(`/api/broadcasts/${id}`)
      if (!res.ok) throw new Error("Not found")
      const data = await res.json()
      setBroadcast(data.broadcast ?? null)
      setRecipients(data.recipients ?? [])
    } catch {
      toast.error("Failed to load broadcast")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [id])

  // Auto-poll while broadcast is actively sending or stopping
  useEffect(() => {
    if (!broadcast) return
    if (broadcast.status !== "sending" && broadcast.status !== "cancelling") return
    const timer = setInterval(() => load(true), 4000)
    return () => clearInterval(timer)
  }, [broadcast?.status])

  async function handleStop() {
    if (!broadcast) return
    setStopping(true)
    try {
      const res = await fetch(`/api/broadcasts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "cancelling" }),
      })
      if (!res.ok) throw new Error("Failed to stop")
      setBroadcast((b) => b ? { ...b, status: "cancelling" } : b)
      toast.success("Stopping broadcast — in-flight messages will finish")
    } catch {
      toast.error("Failed to stop broadcast")
    } finally {
      setStopping(false)
    }
  }

  async function handleRetryFailed() {
    if (!broadcast) return
    setRetrying(true)
    try {
      const res = await fetch(`/api/broadcasts/${id}/retry`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to retry")
      setBroadcast((b) => b ? { ...b, status: "sending" } : b)
      toast.success(`Retrying ${(data as { retrying?: number }).retrying ?? "failed"} recipients in background`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  async function exportToExcel() {
    if (!broadcast) return
    setExporting(true)
    try {
      const xlsx = await import("xlsx")
      const sent: Record<string, string>[] = []
      const skipped: Record<string, string>[] = []

      for (const r of recipients) {
        const row = {
          Name: r.contact?.name ?? "",
          Phone: r.contact?.phone ?? "",
          Email: r.contact?.email ?? "",
          Status: r.status,
          "Sent At": r.sent_at ? format(new Date(r.sent_at), "yyyy-MM-dd HH:mm") : "",
          "Delivered At": r.delivered_at ? format(new Date(r.delivered_at), "yyyy-MM-dd HH:mm") : "",
          "Read At": r.read_at ? format(new Date(r.read_at), "yyyy-MM-dd HH:mm") : "",
          "Replied At": r.replied_at ? format(new Date(r.replied_at), "yyyy-MM-dd HH:mm") : "",
          "Error": r.error_message ?? "",
        }
        if (r.status === "failed") skipped.push(row)
        else sent.push(row)
      }

      const wb = xlsx.utils.book_new()
      xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(sent), "Sent")
      xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(skipped), "Failed")
      xlsx.writeFile(wb, `broadcast-${broadcast.name.replace(/[^a-z0-9]/gi, "_")}.xlsx`)
    } catch {
      toast.error("Export failed")
    } finally {
      setExporting(false)
    }
  }

  const filtered = useMemo(() => {
    let list = recipients
    if (filterTab !== "all") list = list.filter((r) => r.status === filterTab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((r) =>
        r.contact?.name?.toLowerCase().includes(q) ||
        r.contact?.phone?.includes(q) ||
        r.contact?.email?.toLowerCase().includes(q)
      )
    }
    return list
  }, [recipients, filterTab, search])

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: recipients.length }
    for (const r of recipients) counts[r.status] = (counts[r.status] ?? 0) + 1
    return counts
  }, [recipients])

  if (loading) return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-slate-100">
        <div className="h-8 w-8 rounded-lg bg-slate-100 animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-4 w-40 rounded bg-slate-100 animate-pulse" />
          <div className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
        </div>
      </div>
      <div className="p-6 space-y-3 max-w-5xl">
        <div className="grid grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-white rounded-xl animate-pulse" />)}
        </div>
        <div className="h-64 bg-white rounded-xl animate-pulse" />
      </div>
    </div>
  )

  if (!broadcast) return (
    <div className="flex items-center justify-center h-full bg-slate-50">
      <div className="text-center">
        <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-[15px] font-semibold text-slate-600">Broadcast not found</p>
        <button onClick={() => router.push("/broadcasts")} className="mt-3 text-[13px] text-indigo-600 hover:underline">
          ← Back to Broadcasts
        </button>
      </div>
    </div>
  )

  const total = broadcast.total_recipients || recipients.length || 1
  const sentPct     = Math.round((broadcast.sent_count / total) * 100)
  const deliveredPct = Math.round((broadcast.delivered_count / total) * 100)
  const readPct     = Math.round((broadcast.read_count / total) * 100)
  const repliedPct  = Math.round((broadcast.replied_count / total) * 100)
  const failedPct   = Math.round((broadcast.failed_count / total) * 100)

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/broadcasts")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
            <Radio className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-bold text-slate-900 truncate">{broadcast.name}</h1>
              <StatusBadge status={broadcast.status} />
            </div>
            <div className="flex items-center gap-3 text-[12px] text-slate-400 mt-0.5">
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {broadcast.template_name}
              </span>
              <span>·</span>
              <span>Created {format(new Date(broadcast.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
            </div>
          </div>
          {/* Retry Failed — shown when there are failed recipients and not currently sending */}
          {broadcast.failed_count > 0 && broadcast.status !== "sending" && broadcast.status !== "cancelling" && (
            <button
              onClick={handleRetryFailed}
              disabled={retrying}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-200 bg-rose-50 text-[13px] font-medium text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-40"
            >
              <RotateCcw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
              Retry Failed ({broadcast.failed_count})
            </button>
          )}
          {/* Stop — shown while sending */}
          {broadcast.status === "sending" && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-orange-200 bg-orange-50 text-[13px] font-medium text-orange-600 hover:bg-orange-100 transition-colors disabled:opacity-40"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <button
            onClick={exportToExcel}
            disabled={exporting || recipients.length === 0}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 text-[13px] font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
          >
            <Download className={cn("h-3.5 w-3.5", exporting && "animate-bounce")} />
            Export
          </button>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5 max-w-5xl w-full">

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={Users}        label="Recipients" value={broadcast.total_recipients} color="text-indigo-600 bg-indigo-50" />
          <StatCard icon={Send}         label="Sent"       value={broadcast.sent_count}       color="text-blue-600 bg-blue-50" />
          <StatCard icon={CheckCircle2} label="Delivered"  value={broadcast.delivered_count}  color="text-indigo-600 bg-indigo-50" />
          <StatCard icon={Eye}          label="Read"       value={broadcast.read_count}        color="text-emerald-600 bg-emerald-50" />
          <StatCard icon={MessageCircle}label="Replied"    value={broadcast.replied_count}     color="text-violet-600 bg-violet-50" />
          <StatCard icon={XCircle}      label="Failed"     value={broadcast.failed_count}      color="text-rose-600 bg-rose-50" />
        </div>

        {/* ── Delivery Funnel ── */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-4">Delivery Funnel</p>
          <div className="space-y-3">
            {[
              { label: "Sent",      pct: sentPct,      count: broadcast.sent_count,       color: "bg-blue-500" },
              { label: "Delivered", pct: deliveredPct, count: broadcast.delivered_count,  color: "bg-indigo-500" },
              { label: "Read",      pct: readPct,      count: broadcast.read_count,        color: "bg-emerald-500" },
              { label: "Replied",   pct: repliedPct,   count: broadcast.replied_count,     color: "bg-violet-500" },
              { label: "Failed",    pct: failedPct,    count: broadcast.failed_count,      color: "bg-rose-500" },
            ].map(({ label, pct, count, color }) => (
              <div key={label} className="flex items-center gap-3">
                <p className="w-16 shrink-0 text-[12px] text-slate-500">{label}</p>
                <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-20 shrink-0 text-right">
                  <span className="text-[12px] font-semibold text-slate-700">{count.toLocaleString()}</span>
                  <span className="text-[11px] text-slate-400 ml-1">({pct}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Recipients List ── */}
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          {/* List header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <p className="text-[13px] font-semibold text-slate-800">
              Recipients
              <span className="ml-1.5 text-[12px] font-normal text-slate-400">({recipients.length})</span>
            </p>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone…"
                className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[12px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-100 px-4 py-2 scrollbar-none">
            {FILTER_TABS.map((tab) => {
              const count = tabCounts[tab] ?? 0
              if (tab !== "all" && count === 0) return null
              return (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors capitalize shrink-0",
                    filterTab === tab
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  {tab === "all" ? "All" : tab}
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    filterTab === tab ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
                  )}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="h-8 w-8 text-slate-200 mb-2" />
              <p className="text-[13px] text-slate-400">No recipients match</p>
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  <th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Contact</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 hidden sm:table-cell">Phone</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 hidden md:table-cell">Sent At</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 hidden lg:table-cell">Last Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((r) => {
                  const name = r.contact?.name || r.contact?.phone || "Unknown"
                  const phone = r.contact?.phone ?? "—"
                  const initials = name.slice(0, 2).toUpperCase()
                  const lastUpdate = r.replied_at || r.read_at || r.delivered_at || r.sent_at
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Contact */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[11px] font-bold text-indigo-600">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 truncate leading-tight">{name}</p>
                            {r.contact?.email && (
                              <p className="text-[11px] text-slate-400 truncate sm:hidden">{phone}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Phone */}
                      <td className="px-4 py-3 hidden sm:table-cell text-slate-500">{phone}</td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        <div>
                          <RecipientStatusBadge status={r.status} />
                          {r.status === "failed" && r.error_message && (
                            <p className="mt-1 text-[10px] text-rose-400 max-w-[160px] truncate" title={r.error_message}>
                              {r.error_message}
                            </p>
                          )}
                        </div>
                      </td>
                      {/* Sent At */}
                      <td className="px-4 py-3 text-slate-400 hidden md:table-cell text-[12px]">
                        {r.sent_at ? format(new Date(r.sent_at), "MMM d, h:mm a") : "—"}
                      </td>
                      {/* Last Update */}
                      <td className="px-4 py-3 text-slate-400 hidden lg:table-cell text-[12px]">
                        {lastUpdate
                          ? formatDistanceToNow(new Date(lastUpdate), { addSuffix: true })
                          : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
