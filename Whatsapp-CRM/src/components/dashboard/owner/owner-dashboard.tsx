"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { pathAllowedBy } from "@/lib/auth/page-access"
import { apiFetch, errorText } from "@/lib/api-fetch"
import { everyWhileVisible } from "@/lib/visible-interval"
import type { OwnerDashboard } from "@/lib/dashboard/owner-types"
import { ErrorBanner } from "@/components/ui/error-banner"
import { Skeleton } from "@/components/ui/skeleton"
import { VerificationBanner } from "@/components/shared/verification-banner"
import { NewChatDialog } from "@/components/shared/new-chat-dialog"
import { WhatsAppQrButton } from "@/components/shared/whatsapp-qr-button"
import { QuickLinks } from "@/components/dashboard/quick-links"
import { NewLeadsButton } from "@/components/dashboard/new-leads-button"
import { cn } from "@/lib/utils"
import { RoleContext } from "./shared"
import { AttentionTiles } from "./attention"
import { FunnelSection, SourceSection } from "./charts"
import { FollowUpsSection, TeamSection } from "./followups-team"
import { KpiTiles } from "./kpis"
import { TasksSection } from "./tasks"
import { periodLabel, type PeriodKind } from "./view-model"

const PERIODS: Array<{ key: PeriodKind; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
]

function zoneOrUndefined(zone: string | undefined): string | undefined {
  if (!zone) return undefined
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone })
    return zone
  } catch {
    return undefined
  }
}

function greetingFor(nowMs: number, zone: string | undefined): string {
  let hour = new Date(nowMs).getHours()
  try {
    const h = new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: zone }).formatToParts(nowMs).find((p) => p.type === "hour")
    if (h) hour = Number(h.value)
  } catch {
    // keep the browser's hour
  }
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
}

function ago(seconds: number): string {
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds} seconds ago`
  const m = Math.floor(seconds / 60)
  return `${m} ${m === 1 ? "minute" : "minutes"} ago`
}

function SectionSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-40 rounded-xl", className)} />
}

export function OwnerDashboardView() {
  const { profile, accountRole } = useAuth()
  const allowed = (profile?.allowed_pages as string[] | null | undefined) ?? null
  const canWork = !!accountRole && hasMinRole(accountRole, "agent")
  const isAgent = accountRole === "agent"
  const agentLeads = isAgent && (!allowed || pathAllowedBy(allowed, "/leads"))
  const canSetStages = !!accountRole && hasMinRole(accountRole, "admin")

  const [period, setPeriod] = useState<PeriodKind>("month")
  const [data, setData] = useState<OwnerDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [loadedPeriod, setLoadedPeriod] = useState<PeriodKind | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const loadSeq = useRef(0)
  const periodRef = useRef(period)
  useEffect(() => {
    periodRef.current = period
  }, [period])

  const load = useCallback(async (p: PeriodKind) => {
    const seq = ++loadSeq.current
    try {
      const res = await apiFetch(`/api/dashboard/owner?period=${p}`, { cache: "no-store" })
      const body = (await res.json()) as OwnerDashboard
      if (seq !== loadSeq.current) return
      setData(body)
      setLoadedPeriod(p)
      setLoadedAt(Date.now())
      setNowMs(Date.now())
      setError(null)
    } catch (err) {
      console.error("[dashboard] owner load failed", err)
      if (seq !== loadSeq.current) return
      setError(errorText(err, "The dashboard could not be loaded. Check your connection and try again."))
    }
  }, [])

  useEffect(() => {
    // Fetching on mount and when the period changes; the state is set after the response, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load, the rule cannot see the await
    void load(period)
  }, [load, period])

  useEffect(() => everyWhileVisible(() => { void load(periodRef.current) }, 60_000), [load])
  useEffect(() => everyWhileVisible(() => setNowMs(Date.now()), 10_000), [])

  const zone = zoneOrUndefined(data?.period.timeZone)
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "there"
  // The business-zone date only once the zone is known; before that, the browser zone would be a guess.
  const dateText = zone ? new Intl.DateTimeFormat("en", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: zone }).format(nowMs) : null
  const firstLoad = data === null && error === null
  // The figures on screen belong to loadedPeriod; while that differs from the toggle they are shown dimmed and labelled.
  const stale = data !== null && loadedPeriod !== null && loadedPeriod !== period
  const seconds = loadedAt ? Math.max(0, Math.round((nowMs - loadedAt) / 1000)) : 0

  return (
    <RoleContext.Provider value={accountRole ?? null}>
    <div className="min-h-full">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-[20px] font-bold tracking-tight text-foreground">
              {zone ? greetingFor(nowMs, zone) : "Hello"}, {firstName}
            </h1>
            {dateText ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{dateText}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Period">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={period === p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cn(
                    "h-8 rounded-md px-3 text-[12.5px] font-semibold transition-colors",
                    period === p.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <WhatsAppQrButton className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50" />
            {agentLeads ? (
              <NewLeadsButton initial={data?.attention.unassigned ?? null} />
            ) : canWork && (
              <NewChatDialog
                label="New message"
                className="flex h-8 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-[var(--primary-hover)]"
              />
            )}
          </div>
        </header>

        <VerificationBanner />

        {error ? (
          <ErrorBanner
            message={stale && loadedPeriod ? `Could not load ${periodLabel(period)}. Showing ${periodLabel(loadedPeriod)}. ${error}` : error}
            onRetry={() => void load(period)}
          />
        ) : null}

        {firstLoad ? (
          <div className="space-y-4" role="region" aria-busy="true" aria-label="Loading the dashboard">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
            <SectionSkeleton />
            <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
            <div className="grid gap-4 lg:grid-cols-2"><SectionSkeleton /><SectionSkeleton /></div>
            <div className="grid gap-4 lg:grid-cols-2"><SectionSkeleton /><SectionSkeleton /></div>
          </div>
        ) : null}

        {data ? (
          <div className="space-y-4">
            {stale && loadedPeriod ? (
              <p className="text-[12px] font-semibold text-foreground" role="status">Showing {periodLabel(loadedPeriod)}{error ? "" : ". Loading " + periodLabel(period) + "…"}</p>
            ) : null}
          <div className={cn("space-y-4 transition-opacity", stale && "opacity-60")} aria-busy={stale && !error}>
            <AttentionTiles data={data} allowed={allowed} nowMs={nowMs} />
            <TasksSection tasks={data.tasks} teamTasks={data.teamTasks} zone={data.period.timeZone} allowed={allowed} />
            <KpiTiles data={data} allowed={allowed} />
            {/* One grid, no duplicate DOM: phones read follow-ups, funnel, source, team; from lg the mock's two rows. */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={cn("order-1 min-w-0 lg:order-3", !data.team && "lg:col-span-2")}><FollowUpsSection data={data} allowed={allowed} /></div>
              <div className="order-2 min-w-0 lg:order-1"><FunnelSection data={data} allowed={allowed} canSetStages={canSetStages} /></div>
              <div className="order-3 min-w-0 lg:order-2"><SourceSection data={data} allowed={allowed} /></div>
              {data.team ? <div className="order-4 min-w-0"><TeamSection data={data} /></div> : null}
            </div>
          </div>
          </div>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          {loadedAt ? <span>Updated {ago(seconds)}</span> : null}
          <button
            type="button"
            onClick={() => void load(period)}
            className="inline-flex h-8 items-center gap-1 rounded-md px-1 py-0.5 font-semibold text-foreground underline underline-offset-2 hover:bg-muted"
          >
            <RefreshCw aria-hidden className="size-3" /> Refresh
          </button>
          <span>Numbers use the same definitions as Reports. Times are in your business time zone.</span>
        </p>
      </div>

      <QuickLinks links={profile?.quick_links} enabled={profile?.quick_links_enabled} isAgent={isAgent} />
    </div>
    </RoleContext.Provider>
  )
}
