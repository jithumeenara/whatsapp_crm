"use client"

import { useCallback, useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Users, CheckCircle2, XCircle,
  Eye, MessageCircle, Send, Search, Clock, RefreshCw, FileText, Radio, Download,
  RotateCcw, AlertCircle, MessageSquareText, Image as ImageIcon, Film,
  File as FileIcon, ExternalLink, Phone as PhoneIcon, Copy, Zap, Reply,
} from "lucide-react"
import { toast } from "sonner"
import { format, formatDistanceToNow } from "date-fns"
import type { MessageTemplate } from "@/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(" ") }

interface Broadcast {
  id: string
  name: string
  status: string
  template_name: string
  template_language?: string
  header_media_url?: string
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
  /** The actual body text sent to this recipient, after variable
   *  substitution — captured once at send time (migration 031). */
  rendered_body?: string | null
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
  draft:     { label: "Draft",    color: "text-slate-600",   bg: "bg-slate-100" },
  scheduled: { label: "Scheduled", color: "text-amber-700",  bg: "bg-amber-100" },
  sending:   { label: "Sending…", color: "text-blue-700",    bg: "bg-blue-100" },
  sent:      { label: "Sent",     color: "text-emerald-700", bg: "bg-emerald-100" },
  failed:    { label: "Failed",   color: "text-rose-700",    bg: "bg-rose-100" },
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
  const [retrying, setRetrying] = useState(false)
  // Full template row (header/footer/buttons) for the "view sent message"
  // popup — fetched once, matched by name+language against this broadcast.
  const [template, setTemplate] = useState<MessageTemplate | null>(null)
  const [previewRecipient, setPreviewRecipient] = useState<Recipient | null>(null)

  const load = useCallback(async (silent = false) => {
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
  }, [id])

  useEffect(() => { load() }, [load])

  // Fetch the full template row once we know which one this broadcast
  // used, for the "view sent message" popup's header/footer/buttons.
  useEffect(() => {
    if (!broadcast?.template_name || template) return
    fetch('/api/whatsapp/templates')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { templates?: MessageTemplate[] } | null) => {
        const match = j?.templates?.find(
          (t) => t.name === broadcast.template_name && (!broadcast.template_language || t.language === broadcast.template_language),
        ) ?? j?.templates?.find((t) => t.name === broadcast.template_name)
        if (match) setTemplate(match)
      })
      .catch(() => {})
  }, [broadcast, template])

  // Auto-poll while broadcast is actively sending
  useEffect(() => {
    if (!broadcast) return
    if (broadcast.status !== "sending") return
    const timer = setInterval(() => load(true), 4000)
    return () => clearInterval(timer)
  }, [broadcast, load])

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

  // Generation moved server-side (GET /api/broadcasts/[id]/export) —
  // exceljs's browser bundle trips this site's production CSP (script-src
  // has no 'unsafe-eval') just by being loaded, independent of which
  // feature is used. This just downloads the finished file.
  async function exportToExcel() {
    if (!broadcast) return
    setExporting(true)
    try {
      const res = await fetch(`/api/broadcasts/${id}/export`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data as { error?: string }).error ?? "Export failed")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `broadcast-${broadcast.name.replace(/[^a-z0-9]/gi, "_")}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
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
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Identity block */}
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              onClick={() => router.push("/broadcasts")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
              <Radio className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="truncate text-[15px] font-bold text-slate-900 sm:text-[16px]">{broadcast.name}</h1>
                <StatusBadge status={broadcast.status} />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-slate-400 sm:text-[12px]">
                <span className="flex items-center gap-1 truncate">
                  <FileText className="h-3 w-3 shrink-0" />
                  {broadcast.template_name}
                </span>
                <span className="hidden sm:inline">·</span>
                <span className="truncate">Created {format(new Date(broadcast.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            </div>
          </div>

          {/* Actions — wraps below the identity block on mobile instead of overlapping it */}
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {broadcast.failed_count > 0 && broadcast.status !== "sending" && broadcast.status !== "cancelling" && (
              <button
                onClick={handleRetryFailed}
                disabled={retrying}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-[12.5px] font-medium text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-40"
              >
                <RotateCcw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
                Retry Failed ({broadcast.failed_count})
              </button>
            )}
            <button
              onClick={exportToExcel}
              disabled={exporting || recipients.length === 0}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
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
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5 max-w-5xl w-full">

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
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Message</th>
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
                      {/* View sent message */}
                      <td className="px-4 py-3 text-right">
                        {r.rendered_body ? (
                          <button
                            type="button"
                            onClick={() => setPreviewRecipient(r)}
                            title="View sent message"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="text-slate-200">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* View sent message popup */}
      <Dialog open={!!previewRecipient} onOpenChange={(v) => { if (!v) setPreviewRecipient(null); }}>
        <DialogContent className="gap-0 overflow-hidden rounded-3xl bg-white p-0 sm:max-w-sm">
          <DialogHeader className="bg-gradient-to-br from-indigo-50 to-white px-6 pb-4 pt-6">
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100">
              <MessageSquareText className="h-5 w-5 text-indigo-600" />
            </div>
            <DialogTitle className="text-[16px] font-bold text-slate-800">Sent Message</DialogTitle>
            <p className="mt-0.5 text-[12px] text-slate-400">
              {previewRecipient?.contact?.name || previewRecipient?.contact?.phone || "This recipient"}
            </p>
          </DialogHeader>

          {previewRecipient && (
            <div className="px-6 pb-6">
              <div
                className="overflow-hidden rounded-2xl p-3"
                style={{
                  backgroundColor: "#e5ddd5",
                  backgroundImage:
                    "radial-gradient(circle at 12% 22%, rgba(255,255,255,0.35) 0, transparent 40%), radial-gradient(circle at 82% 72%, rgba(255,255,255,0.3) 0, transparent 45%)",
                }}
              >
                <div className="flex max-h-[380px] flex-col items-end overflow-y-auto">
                  <div className="relative max-w-[92%] rounded-lg rounded-tr-none bg-[#d9fdd3] shadow-sm">
                    <span
                      className="absolute right-[-8px] top-0 h-0 w-0"
                      style={{ borderTop: "8px solid #d9fdd3", borderRight: "8px solid transparent" }}
                    />

                    {template?.header_type === "image" && (
                      <div className="overflow-hidden rounded-t-lg rounded-tr-none bg-slate-200">
                        {broadcast.header_media_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={broadcast.header_media_url} alt="" className="max-h-40 w-full object-cover" />
                        ) : (
                          <div className="flex h-20 items-center justify-center text-slate-400"><ImageIcon className="h-6 w-6" /></div>
                        )}
                      </div>
                    )}
                    {template?.header_type === "video" && (
                      <div className="overflow-hidden rounded-t-lg rounded-tr-none bg-black">
                        {broadcast.header_media_url ? (
                          <video src={broadcast.header_media_url} controls muted className="max-h-40 w-full" />
                        ) : (
                          <div className="flex h-20 items-center justify-center text-white/70"><Film className="h-6 w-6" /></div>
                        )}
                      </div>
                    )}
                    {template?.header_type === "document" && (
                      <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-black/5 p-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-100">
                          <FileIcon className="h-4.5 w-4.5 text-rose-500" />
                        </div>
                        <p className="truncate text-[12px] text-[#111b21]">{broadcast.header_media_url?.split("/").pop() ?? "Document"}</p>
                      </div>
                    )}

                    <div className="px-3 pb-1.5 pt-2">
                      {template?.header_type === "text" && template.header_content && (
                        <p className="mb-1 text-[14.2px] font-bold leading-snug text-[#111b21]">{template.header_content}</p>
                      )}
                      <p className="whitespace-pre-wrap text-[14.2px] leading-[19px] text-[#111b21]">
                        {previewRecipient.rendered_body}
                      </p>
                      {template?.footer_text && (
                        <p className="mt-1 text-[13px] text-[#667781]">{template.footer_text}</p>
                      )}
                      <div className="flex items-center justify-end gap-1 pt-1">
                        <span className="text-[11px] text-[#667781]">
                          {previewRecipient.sent_at ? format(new Date(previewRecipient.sent_at), "h:mm a") : "—"}
                        </span>
                        {previewRecipient.status !== "failed" && (
                          <svg viewBox="0 0 16 11" className="h-2.5 w-3.5" fill="none">
                            <path d="M1 5.5L4.5 9 11 1.5" stroke="#53bdeb" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M5 5.5L8.5 9 15 1.5" stroke="#53bdeb" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>

                  {template?.buttons && template.buttons.length > 0 && (
                    <div className="mt-0.5 w-full max-w-[92%] overflow-hidden rounded-lg bg-white shadow-sm">
                      {template.buttons.map((b, i) => {
                        const Icon =
                          b.type === "URL" ? ExternalLink :
                          b.type === "PHONE_NUMBER" ? PhoneIcon :
                          b.type === "COPY_CODE" ? Copy :
                          b.type === "FLOW" ? Zap :
                          Reply;
                        return (
                          <div key={i} className={`flex items-center justify-center gap-2 py-2 ${i > 0 ? "border-t border-slate-100" : ""}`}>
                            <Icon className="h-3.5 w-3.5 text-[#00a5f4]" />
                            <span className="text-[13px] font-medium text-[#00a5f4]">{b.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {previewRecipient.status === "failed" && previewRecipient.error_message && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  <p className="text-[11.5px] text-rose-600">{previewRecipient.error_message}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
