"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
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
  ArrowUp,
  ArrowDown,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Users,
  TrendingUp,
  Activity,
  Clock,
  Megaphone,
  Zap,
} from "lucide-react"
import { VerificationBanner } from "@/components/shared/verification-banner"
import { NewChatDialog } from "@/components/shared/new-chat-dialog"
import { WhatsAppQrButton } from "@/components/shared/whatsapp-qr-button"
import { QuickLinks } from "@/components/dashboard/quick-links"
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  CRMStats,
  MetricsBundle,
  ResponseTimeSummary,
  Sparks,
} from "@/lib/dashboard/types"

// ─── helpers ──────────────────────────────────────────────────────────

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

/** Change from one figure to the next as a percentage, or null when
 *  there is nothing to compare against — "up ∞%" helps nobody. */
function change(curr: number, prev: number): number | null {
  if (!prev) return null
  return Math.round(((curr - prev) / prev) * 1000) / 10
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const RANGES = [7, 30, 90] as const
type RangeDays = (typeof RANGES)[number]

const CARD = "rounded-2xl border border-slate-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]"
const TOOLTIP = {
  contentStyle: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    fontSize: "12px",
    boxShadow: "0 6px 20px rgba(15,23,42,0.08)",
  },
  labelStyle: { color: "#475569", fontWeight: 600, marginBottom: 4 },
}

interface Overview {
  metrics: MetricsBundle
  series: ConversationsSeriesPoint[]
  responseTime: ResponseTimeSummary
  activity: ActivityItem[]
  crm: CRMStats
  sparks: Sparks
}

interface PerfRow {
  user_id: string
  full_name: string
  picked: number
  attempted: number
  reached: number
  reachedPct: number | null
  won: number
  lost: number
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-slate-100", className)} />
}

// ─── headline card ─────────────────────────────────────────────────────

const TONES = {
  indigo: { tile: "bg-indigo-100 text-indigo-600", stroke: "#6366f1" },
  green: { tile: "bg-primary/15 text-primary", stroke: "var(--primary)" },
  amber: { tile: "bg-amber-100 text-amber-600", stroke: "#f59e0b" },
  rose: { tile: "bg-rose-100 text-rose-500", stroke: "#f43f5e" },
} as const

function KpiCard({
  id, label, value, delta, deltaLabel, icon: Icon, tone, spark, href,
}: {
  id: string
  label: string
  value: number
  delta: number | null
  deltaLabel: string
  icon: React.ComponentType<{ className?: string }>
  tone: keyof typeof TONES
  spark: number[]
  href?: string
}) {
  const t = TONES[tone]
  const data = spark.map((v, i) => ({ i, v }))
  const body = (
    <div className={cn(CARD, "group relative flex h-full items-stretch gap-4 overflow-hidden p-5 transition-shadow hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]")}>
      <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", t.tile)}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-[28px] font-bold leading-none tabular-nums text-slate-900">{value.toLocaleString()}</p>
        <p className="mt-2 flex items-center gap-1 text-[12px]">
          {delta === null ? (
            <span className="text-slate-400">No change data yet</span>
          ) : (
            <>
              <span className={cn("inline-flex items-center gap-0.5 font-semibold", delta >= 0 ? "text-emerald-600" : "text-rose-500")}>
                {delta >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(delta)}%
              </span>
              <span className="text-slate-400">{deltaLabel}</span>
            </>
          )}
        </p>
      </div>
      {/* The last seven days, drawn small. No axis: it answers "rising
          or falling", and the number beside it answers "how many". */}
      <div className="pointer-events-none absolute bottom-3 right-3 h-12 w-28" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.stroke} stopOpacity={0.25} />
                <stop offset="100%" stopColor={t.stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={t.stroke} strokeWidth={2} fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

// ─── activity ──────────────────────────────────────────────────────────

const KIND = {
  message: { tile: "bg-indigo-50 text-indigo-600", icon: MessageSquare },
  broadcast: { tile: "bg-amber-50 text-amber-600", icon: Megaphone },
  automation: { tile: "bg-violet-50 text-violet-600", icon: Zap },
  contact: { tile: "bg-primary/10 text-primary", icon: UserPlus },
} as const

function ActivityRow({ item }: { item: ActivityItem }) {
  const k = KIND[item.kind] ?? KIND.message
  const Icon = k.icon
  const row = (
    <div className="flex items-start gap-3 py-3">
      <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", k.tile)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-slate-800">{item.text}</p>
        {item.detail && <p className="mt-0.5 truncate text-[12px] text-slate-500">{item.detail}</p>}
      </div>
      <span className="shrink-0 pt-0.5 text-[11px] text-slate-400">{relativeTime(item.at)}</span>
    </div>
  )
  return item.href ? (
    <Link href={item.href} className="-mx-2 block rounded-xl px-2 transition-colors hover:bg-slate-50">{row}</Link>
  ) : (
    <div className="-mx-2 px-2">{row}</div>
  )
}

// ─── team performance ──────────────────────────────────────────────────

function TeamTable({ days, isManager }: { days: number; isManager: boolean }) {
  const [rows, setRows] = useState<PerfRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/dashboard/performance?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return
        if (isManager && Array.isArray(body.team)) setRows(body.team)
        else if (body.me) setRows([{ ...body.me, user_id: "me", full_name: "You" }])
        else setRows([])
      })
      .catch(() => !cancelled && setRows([]))
    return () => { cancelled = true }
  }, [days, isManager])

  // Nobody who did nothing at all — a roster padded with zeros buries
  // the people who worked.
  const active = (rows ?? []).filter((r) => r.picked > 0 || r.attempted > 0 || r.won > 0 || r.lost > 0)

  return (
    <div className={cn(CARD, "p-5")}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">{isManager ? "Team Performance" : "Your Work"}</h2>
          <p className="text-[12px] text-slate-500">Last {days} days</p>
        </div>
        <Link href="/leads" className="flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {rows === null ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : active.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-slate-400">
          Nothing recorded yet. Figures appear as leads are picked and calls logged.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                <th className="pb-2 font-medium">Agent</th>
                <th className="pb-2 text-right font-medium">Picked</th>
                <th className="pb-2 text-right font-medium">Calls</th>
                <th className="pb-2 text-right font-medium">Got through</th>
                <th className="pb-2 text-right font-medium">Won</th>
                <th className="pb-2 text-right font-medium">Lost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {active.map((r) => (
                <tr key={r.user_id} className="text-slate-700">
                  <td className="py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-[12px] font-bold text-primary">
                        {(r.full_name || "?").charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium text-slate-800">{r.full_name || "—"}</span>
                    </span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{r.picked}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.attempted}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {r.reached}
                    {r.reachedPct !== null && <span className="ml-1 text-[11px] text-slate-400">({r.reachedPct}%)</span>}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{r.won}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.lost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── quick stat tile ───────────────────────────────────────────────────

function QuickTile({
  href, icon: Icon, tile, bg, value, label, sub,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  tile: string
  bg: string
  value: number | string
  label: string
  sub: string
}) {
  return (
    <Link href={href} className={cn("group flex items-start gap-3 rounded-2xl p-4 transition-shadow hover:shadow-md", bg)}>
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm", tile)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[22px] font-bold leading-none tabular-nums text-slate-900">{value}</p>
        <p className="mt-1.5 text-[13px] font-medium text-slate-700">{label}</p>
        <p className="text-[11px] text-slate-500">{sub}</p>
      </div>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/80 text-slate-500 transition-transform group-hover:translate-x-0.5">
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  )
}

// ─── page ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { profile, accountRole } = useAuth()
  // useAuth's role flags are exact matches, so rank explicitly: the team
  // panels are for supervisors and above, never for a viewer.
  const isManager = !!accountRole && hasMinRole(accountRole, "supervisor")
  const canWork = !!accountRole && hasMinRole(accountRole, "agent")

  const [range, setRange] = useState<RangeDays>(7)
  // Which period the figures on screen are for. Loading is "the period
  // asked for is not the one shown"; the previous figures stay up
  // meanwhile rather than flashing to skeletons on every switch.
  const [loaded, setLoaded] = useState<{ range: RangeDays; data: Overview | null; error: boolean } | null>(null)
  const data = loaded?.data ?? null
  const loading = loaded?.range !== range
  const error = !loading && !!loaded?.error

  useEffect(() => {
    let cancelled = false
    fetch(`/api/dashboard?section=overview&range=${range}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<Overview>
      })
      .then((d) => { if (!cancelled) setLoaded({ range, data: d, error: false }) })
      .catch(() => { if (!cancelled) setLoaded((prev) => ({ range, data: prev?.data ?? null, error: true })) })
    return () => { cancelled = true }
  }, [range])

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "there"

  const sparks = data?.sparks
  const last = (arr?: number[]) => (arr && arr.length ? arr[arr.length - 1] : 0)
  const prev = (arr?: number[]) => (arr && arr.length > 1 ? arr[arr.length - 2] : 0)

  const trend = useMemo(
    () =>
      (data?.series ?? []).map((pt) => ({
        day: new Date(pt.day).toLocaleDateString("en", { month: "short", day: "numeric" }),
        Incoming: pt.incoming,
        Outgoing: pt.outgoing,
      })),
    [data?.series],
  )

  const rt = data?.responseTime
  const rtData = rt?.buckets.map((b) => ({ day: DOW_LABELS[b.dow], Minutes: Math.round((b.avgMinutes ?? 0) * 10) / 10 })) ?? []
  const fmtMinutes = (m: number | null | undefined) =>
    m == null ? "—" : m < 60 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1)}h`

  const crm = data?.crm

  return (
    <div className="relative min-h-full">
      {/* Soft wash behind the greeting, fading into the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-br from-primary/10 via-sky-50/60 to-transparent"
      />

      <div className="relative p-5 lg:p-8">
        {/* ── Greeting ─────────────────────────────────────────────── */}
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-slate-900">
              {greeting}, <span className="text-primary">{firstName}</span> <span aria-hidden="true">👋</span>
            </h1>
            <p className="mt-1 text-[14px] text-slate-500">
              {now.toLocaleDateString("en", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
            <p className="mt-1 text-[14px] text-slate-500">Here&apos;s what&apos;s happening with your conversations today.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="relative flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white pl-3 pr-2 text-[13px] font-medium text-slate-700 shadow-sm">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              <span className="sr-only">Period</span>
              <select
                id="dashboard-range"
                value={range}
                onChange={(e) => setRange(Number(e.target.value) as RangeDays)}
                className="cursor-pointer appearance-none bg-transparent pr-5 outline-none"
              >
                {RANGES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
              </select>
              <ArrowDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
            </label>
            <WhatsAppQrButton className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50" />
            {canWork && (
              <NewChatDialog
                label="New Message"
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[var(--primary-hover)]"
              />
            )}
          </div>
        </div>

        <VerificationBanner />

        {error && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            The dashboard figures could not be loaded. Refresh the page to try again.
          </div>
        )}

        {/* ── Headline cards ───────────────────────────────────────── */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {loading && !data ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px]" />)
          ) : (
            <>
              <KpiCard
                id="conv" label="Active Conversations" tone="indigo" icon={MessageSquare} href="/inbox"
                value={data?.metrics.activeConversations.current ?? 0}
                delta={change(last(sparks?.conversations), prev(sparks?.conversations))}
                deltaLabel="vs yesterday"
                spark={sparks?.conversations ?? []}
              />
              <KpiCard
                id="contacts" label="New Contacts Today" tone="green" icon={UserPlus} href="/contacts"
                value={data?.metrics.newContactsToday.current ?? 0}
                delta={change(data?.metrics.newContactsToday.current ?? 0, data?.metrics.newContactsToday.previous ?? 0)}
                deltaLabel="vs yesterday"
                spark={sparks?.newContacts ?? []}
              />
              <KpiCard
                id="sent" label="Messages Sent Today" tone="amber" icon={Send} href="/inbox"
                value={data?.metrics.messagesSentToday.current ?? 0}
                delta={change(data?.metrics.messagesSentToday.current ?? 0, data?.metrics.messagesSentToday.previous ?? 0)}
                deltaLabel="vs yesterday"
                spark={sparks?.messagesSent ?? []}
              />
              <KpiCard
                id="hot" label="Hot Leads" tone="rose" icon={Flame} href="/leads"
                value={crm?.hotLeads ?? 0}
                delta={change(last(sparks?.hotLeads), prev(sparks?.hotLeads))}
                deltaLabel="new vs yesterday"
                spark={sparks?.hotLeads ?? []}
              />
            </>
          )}
        </div>

        {/* ── Trend + activity ─────────────────────────────────────── */}
        <div className="mb-6 grid gap-6 lg:grid-cols-3">
          <div className={cn(CARD, "p-5 lg:col-span-2")}>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900">Conversation Trend</h2>
                <p className="mt-0.5 text-[12px] text-slate-500">Incoming vs outgoing messages</p>
              </div>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Period">
                {RANGES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setRange(d)}
                    aria-pressed={range === d}
                    className={cn(
                      "rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
                      range === d ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-500 hover:text-slate-800",
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {loading && !data ? (
              <Skeleton className="h-[260px]" />
            ) : trend.every((p) => p.Incoming === 0 && p.Outgoing === 0) ? (
              <div className="flex h-[260px] items-center justify-center text-[13px] text-slate-400">No messages in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trend} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trend-in" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="trend-out" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={18} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...TOOLTIP} />
                  <Area type="monotone" dataKey="Incoming" stroke="#6366f1" strokeWidth={2.5} fill="url(#trend-in)" dot={false} />
                  <Area type="monotone" dataKey="Outgoing" stroke="var(--primary)" strokeWidth={2.5} fill="url(#trend-out)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <div className="mt-3 flex gap-5">
              <span className="flex items-center gap-2 text-[12px] text-slate-600"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />Incoming</span>
              <span className="flex items-center gap-2 text-[12px] text-slate-600"><span className="h-2.5 w-2.5 rounded-full bg-primary" />Outgoing</span>
            </div>
          </div>

          <div className={cn(CARD, "p-5")}>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Recent Activity</h2>
              <Link href="/inbox" className="flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {loading && !data ? (
              <div className="space-y-3 pt-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (data?.activity ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Activity className="mb-2 h-8 w-8 text-slate-200" />
                <p className="text-[12px] text-slate-400">No recent activity</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data!.activity.slice(0, 6).map((item) => <ActivityRow key={item.id} item={item} />)}
              </div>
            )}
          </div>
        </div>

        {/* ── Team, response time, quick stats ─────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-3">
          {canWork && <TeamTable days={range > 30 ? 30 : range} isManager={isManager} />}

          {isManager && (
            <div className={cn(CARD, "p-5")}>
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-slate-900">Response Time</h2>
                  <p className="text-[12px] text-slate-500">Avg first reply per day</p>
                </div>
                <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[13px] font-semibold text-slate-700">
                  <Clock className="h-3.5 w-3.5 text-slate-400" /> {fmtMinutes(rt?.thisWeekAvg)}
                </span>
              </div>
              {loading && !data ? (
                <Skeleton className="h-[190px]" />
              ) : (
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={rtData} margin={{ top: 6, right: 0, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                    <Tooltip {...TOOLTIP} formatter={(v) => [`${v} min`, "Avg first reply"]} cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="Minutes" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          <div className={cn(CARD, "p-5", !isManager && canWork && "lg:col-span-2", !canWork && "lg:col-span-3")}>
            <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Quick Stats</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickTile
                href="/follow-ups" icon={CalendarClock} tile="text-amber-600" bg="bg-amber-50"
                value={loading && !data ? "—" : crm?.overdueFollowUps ?? 0}
                label="Overdue follow-ups" sub={`${crm?.pendingFollowUps ?? 0} coming up`}
              />
              <QuickTile
                href="/tasks" icon={CheckSquare} tile="text-violet-600" bg="bg-violet-50"
                value={loading && !data ? "—" : crm?.pendingTasks ?? 0}
                label="Tasks open" sub={`${crm?.overdueTasks ?? 0} overdue`}
              />
              <QuickTile
                href="/settings" icon={Users} tile="text-primary" bg="bg-primary/10"
                value={loading && !data ? "—" : crm?.teamMembers ?? 0}
                label="Team members" sub="People who can reply"
              />
              <QuickTile
                href="/leads" icon={TrendingUp} tile="text-orange-500" bg="bg-orange-50"
                value={loading && !data ? "—" : crm?.totalLeads ?? 0}
                label="Total leads" sub="In your pipeline"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Somebody's own shortcuts; positions itself. */}
      <QuickLinks
        links={profile?.quick_links}
        enabled={profile?.quick_links_enabled}
        isAgent={accountRole === "agent"}
      />
    </div>
  )
}
