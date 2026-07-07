"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts"
import {
  MessageSquare,
  UserPlus,
  Send,
  Flame,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  CalendarCheck,
  CheckSquare,
  Activity,
  Clock,
  AlertTriangle,
} from "lucide-react"
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  CRMStats,
  MetricsBundle,
  ResponseTimeSummary,
} from "@/lib/dashboard/types"

// ---- helpers ----

function cn(...c: (string | boolean | undefined | null)[]) {
  return c.filter(Boolean).join(" ")
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function pct(curr: number, prev: number) {
  if (!prev) return null
  return Math.round(((curr - prev) / prev) * 100)
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// ---- skeleton ----

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-xl bg-slate-100", className)} />
  )
}

// ---- metric card ----

interface MetricCardProps {
  label: string
  value: number
  delta?: number | null
  icon: React.ReactNode
  accent: string
  href?: string
  loading?: boolean
}

function MetricCard({ label, value, delta, icon, accent, href, loading }: MetricCardProps) {
  const content = (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col gap-4 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow">
      <div className="flex items-start justify-between">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", accent)}>
          {icon}
        </div>
        {delta !== null && delta !== undefined && (
          <div className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            delta >= 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-600",
          )}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(delta)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-[28px] font-bold text-slate-900 leading-none">{loading ? "—" : value.toLocaleString()}</p>
        <p className="mt-1 text-[13px] text-slate-500">{label}</p>
      </div>
    </div>
  )

  if (href) {
    return <Link href={href} className="block">{content}</Link>
  }
  return content
}

// ---- activity item ----

const KIND_CONFIG = {
  message:    { color: "bg-indigo-100 text-indigo-600", icon: MessageSquare },
  broadcast:  { color: "bg-amber-100 text-amber-600",  icon: Send },
  automation: { color: "bg-violet-100 text-violet-600", icon: Activity },
  contact:    { color: "bg-emerald-100 text-emerald-600", icon: UserPlus },
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const cfg = KIND_CONFIG[item.kind] ?? KIND_CONFIG.message
  const Icon = cfg.icon
  const row = (
    <div className="flex items-start gap-3 py-2.5">
      <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", cfg.color)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-slate-700 leading-snug">{item.text}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{relativeTime(item.at)}</p>
      </div>
    </div>
  )

  if (item.href) {
    return <Link href={item.href} className="block hover:bg-slate-50 rounded-lg px-1 -mx-1 transition-colors">{row}</Link>
  }
  return <div className="px-1 -mx-1">{row}</div>
}

// ---- status chip ----

const STATUS_COLOR: Record<string, string> = {
  new:               "bg-indigo-50 text-indigo-700",
  call_not_connected: "bg-amber-50 text-amber-700",
  visited:            "bg-sky-50 text-sky-700",
  appointment_fixed:  "bg-violet-50 text-violet-700",
  follow_up:          "bg-orange-50 text-orange-700",
  closed:             "bg-emerald-50 text-emerald-700",
}

const STATUS_LABEL: Record<string, string> = {
  new:               "New",
  call_not_connected: "Not Connected",
  visited:            "Visited",
  appointment_fixed:  "Appt. Fixed",
  follow_up:          "Follow-up",
  closed:             "Closed",
}

// ---- page ----

type RangeDays = 7 | 30 | 90

async function fetchSection(section: string, extra: Record<string, string> = {}) {
  const url = new URL("/api/dashboard", window.location.origin)
  url.searchParams.set("section", section)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error("Dashboard fetch failed")
  return res.json()
}

export default function DashboardV2() {
  const { profile, isAgent } = useAuth()

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [series, setSeries] = useState<ConversationsSeriesPoint[]>([])
  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [crm, setCrm] = useState<CRMStats | null>(null)
  const [range, setRange] = useState<RangeDays>(7)
  const [loading, setLoading] = useState(true)

  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchSection("metrics"),
      fetchSection("all", { days: String(range) }),
      fetchSection("crm_stats"),
    ])
      .then(([m, all, c]) => {
        setMetrics(m)
        setSeries(all.series ?? [])
        setResponseTime(all.responseTime ?? null)
        setActivity(all.activity ?? [])
        setCrm(c)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [range])

  const chartData = series.map((pt) => ({
    day: new Date(pt.day).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }),
    Incoming: pt.incoming,
    Outgoing: pt.outgoing,
  }))

  const rtData = responseTime?.buckets.map((b) => ({
    day: DOW_LABELS[b.dow],
    Minutes: b.avgMinutes ?? 0,
  })) ?? []

  const m = metrics

  return (
    <div className="min-h-full p-6 lg:p-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-[22px] font-bold text-slate-900">
          {greeting}, {profile?.full_name?.split(" ")[0] ?? "there"} 👋
        </h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          {new Date().toLocaleDateString("en", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-8">
        {loading ? (
          <>
            <SkeletonBlock className="h-[120px]" />
            <SkeletonBlock className="h-[120px]" />
            <SkeletonBlock className="h-[120px]" />
            <SkeletonBlock className="h-[120px]" />
          </>
        ) : (
          <>
            <MetricCard
              label="Active Conversations"
              value={m?.activeConversations.current ?? 0}
              delta={pct(m?.activeConversations.current ?? 0, m?.activeConversations.previous ?? 0)}
              icon={<MessageSquare className="h-5 w-5 text-indigo-600" />}
              accent="bg-indigo-50"
              href="/inbox"
            />
            <MetricCard
              label="New Contacts Today"
              value={m?.newContactsToday.current ?? 0}
              delta={pct(m?.newContactsToday.current ?? 0, m?.newContactsToday.previous ?? 0)}
              icon={<UserPlus className="h-5 w-5 text-emerald-600" />}
              accent="bg-emerald-50"
              href="/contacts"
            />
            <MetricCard
              label="Messages Sent Today"
              value={m?.messagesSentToday.current ?? 0}
              delta={pct(m?.messagesSentToday.current ?? 0, m?.messagesSentToday.previous ?? 0)}
              icon={<Send className="h-5 w-5 text-sky-600" />}
              accent="bg-sky-50"
            />
            <MetricCard
              label="Hot Leads"
              value={crm?.hotLeads ?? 0}
              icon={<Flame className="h-5 w-5 text-rose-500" />}
              accent="bg-rose-50"
              href="/leads"
            />
          </>
        )}
      </div>

      {/* Charts + Activity */}
      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        {/* Conversation trend */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-900">Conversation Trend</h2>
              <p className="text-[12px] text-slate-500 mt-0.5">Incoming vs outgoing messages</p>
            </div>
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {([7, 30, 90] as RangeDays[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRange(d)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                    range === d
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <SkeletonBlock className="h-[200px]" />
          ) : chartData.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-[13px] text-slate-400">
              No data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="inGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                  labelStyle={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}
                />
                <Area type="monotone" dataKey="Incoming" stroke="#6366f1" strokeWidth={2} fill="url(#inGrad)" dot={false} />
                <Area type="monotone" dataKey="Outgoing" stroke="#10b981" strokeWidth={2} fill="url(#outGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {/* Legend */}
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
              Incoming
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Outgoing
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-semibold text-slate-900">Recent Activity</h2>
            <Activity className="h-4 w-4 text-slate-400" />
          </div>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <SkeletonBlock key={i} className="h-12" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Activity className="h-8 w-8 text-slate-200 mb-2" />
              <p className="text-[12px] text-slate-400">No recent activity</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {activity.slice(0, 8).map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: CRM stats + Response time + Quick links */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* CRM funnel */}
        {!isAgent && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900">Lead Pipeline</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">{crm?.totalLeads ?? 0} total leads</p>
              </div>
              <Link href="/leads" className="flex items-center gap-1 text-[12px] font-medium text-indigo-600 hover:text-indigo-700">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-8" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {(crm?.leadsByStatus ?? []).map((row) => (
                  <div key={row.status} className="flex items-center gap-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium w-[110px] shrink-0", STATUS_COLOR[row.status] ?? "bg-slate-50 text-slate-600")}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${crm?.totalLeads ? Math.round((row.count / crm.totalLeads) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="text-[12px] font-semibold text-slate-700 w-6 text-right">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Response time chart */}
        {!isAgent && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900">Response Time</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Avg first reply per day</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                {responseTime?.thisWeekAvg != null && (
                  <span className="text-[12px] font-semibold text-slate-700">
                    {responseTime.thisWeekAvg < 60
                      ? `${Math.round(responseTime.thisWeekAvg)}m`
                      : `${(responseTime.thisWeekAvg / 60).toFixed(1)}h`}
                  </span>
                )}
              </div>
            </div>
            {loading ? (
              <SkeletonBlock className="h-[160px]" />
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={rtData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                    formatter={(val) => [`${val}m`, "Avg Response"]}
                  />
                  <Bar dataKey="Minutes" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Quick stats / CTA cards */}
        <div className="space-y-4">
          {/* Follow-ups overdue */}
          <div className={cn(
            "rounded-2xl border p-4 flex items-center gap-4",
            (crm?.overdueFollowUps ?? 0) > 0
              ? "bg-rose-50 border-rose-100"
              : "bg-white border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)]",
          )}>
            <div className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              (crm?.overdueFollowUps ?? 0) > 0 ? "bg-rose-100" : "bg-amber-50",
            )}>
              {(crm?.overdueFollowUps ?? 0) > 0
                ? <AlertTriangle className="h-5 w-5 text-rose-600" />
                : <CalendarCheck className="h-5 w-5 text-amber-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-900">
                {loading ? "—" : `${crm?.overdueFollowUps ?? 0} overdue follow-up${(crm?.overdueFollowUps ?? 0) !== 1 ? "s" : ""}`}
              </p>
              <p className="text-[11px] text-slate-500">{crm?.pendingFollowUps ?? 0} pending total</p>
            </div>
            <Link href="/follow-ups" className="shrink-0 text-indigo-600 hover:text-indigo-700">
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Tasks pending */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50">
              <CheckSquare className="h-5 w-5 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-900">
                {loading ? "—" : `${crm?.pendingTasks ?? 0} task${(crm?.pendingTasks ?? 0) !== 1 ? "s" : ""} open`}
              </p>
              <p className="text-[11px] text-slate-500">{crm?.overdueTasks ?? 0} overdue</p>
            </div>
            <Link href="/tasks" className="shrink-0 text-indigo-600 hover:text-indigo-700">
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Hot leads */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50">
              <TrendingUp className="h-5 w-5 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-900">
                {loading ? "—" : `${crm?.hotLeads ?? 0} hot lead${(crm?.hotLeads ?? 0) !== 1 ? "s" : ""}`}
              </p>
              <p className="text-[11px] text-slate-500">in your pipeline</p>
            </div>
            <Link href="/leads" className="shrink-0 text-indigo-600 hover:text-indigo-700">
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
