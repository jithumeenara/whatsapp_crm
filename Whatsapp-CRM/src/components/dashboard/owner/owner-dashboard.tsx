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
import { SpendSection } from "./spend"
import { TasksSection } from "./tasks"
import { periodLabel, type PeriodKind } from "./view-model"

/** A cached period younger than this is shown without asking again (the server caches 30 s too). */
const FRESH_MS = 30_000

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

  // Each period's last answer, so switching Today / This week / This month
  // shows figures at once and refreshes behind them. One request per
  // period at a time, however often a button is hovered or pressed.
  const cacheRef = useRef(new Map<PeriodKind, { data: OwnerDashboard; at: number }>())
  const inflightRef = useRef(new Map<PeriodKind, Promise<OwnerDashboard>>())

  const fetchPeriod = useCallback((p: PeriodKind): Promise<OwnerDashboard> => {
    const running = inflightRef.current.get(p)
    if (running) return running
    const req = (async () => {
      const res = await apiFetch(`/api/dashboard/owner?period=${p}`, { cache: "no-store" })
      const body = (await res.json()) as OwnerDashboard
      cacheRef.current.set(p, { data: body, at: Date.now() })
      return body
    })()
    inflightRef.current.set(p, req)
    void req.finally(() => inflightRef.current.delete(p)).catch(() => {})
    return req
  }, [])

  const load = useCallback(async (p: PeriodKind) => {
    const seq = ++loadSeq.current
    try {
      const body = await fetchPeriod(p)
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
  }, [fetchPeriod])

  /** Hovering or focusing a period fetches it ahead, so the press is instant. */
  const prefetch = useCallback((p: PeriodKind) => {
    const hit = cacheRef.current.get(p)
    if (hit && Date.now() - hit.at < FRESH_MS) return
    fetchPeriod(p).catch((err) => console.warn("[dashboard] prefetch failed", err))
  }, [fetchPeriod])

  const selectPeriod = useCallback((p: PeriodKind) => {
    setPeriod(p)
    const hit = cacheRef.current.get(p)
    if (hit) {
      loadSeq.current++ // an older answer for another period must not land on top
      setData(hit.data)
      setLoadedPeriod(p)
      setLoadedAt(hit.at)
      setError(null)
    }
    if (!hit || Date.now() - hit.at >= FRESH_MS) void load(p)
  }, [load])

  useEffect(() => {
    // The first load; the state is set after the response, never synchronously.
    void load(periodRef.current)
  }, [load])

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
    {/* A soft wash behind the glass cards; the cards stay white so every theme reads the same. */}
    <div className="min-h-full bg-[radial-gradient(1200px_600px_at_0%_0%,rgba(237,233,254,0.7),transparent_60%),radial-gradient(900px_500px_at_100%_100%,rgba(255,228,230,0.55),transparent_60%)]">
      <div className="mx-auto max-w-[1400px] space-y-4 px-4 pb-4 sm:space-y-5 lg:px-6 lg:pb-6">
        {/* From sm, stays at the top while the page scrolls, so the period is always one click away.
            Not on phones: there it would cover a third of the screen. */}
        <header className="z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:sticky sm:top-0 sm:bg-white/40 sm:backdrop-blur-xl lg:-mx-6 lg:px-6 lg:py-4">
          <div className="min-w-0">
            <h1 className="break-words text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">
              {zone ? greetingFor(nowMs, zone) : "Hello"}, {firstName}!
            </h1>
            {dateText ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{dateText}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-slate-900/[0.04] p-1 ring-1 ring-slate-200/70 backdrop-blur" role="group" aria-label="Period">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={period === p.key}
                  onClick={() => selectPeriod(p.key)}
                  onPointerEnter={() => prefetch(p.key)}
                  onFocus={() => prefetch(p.key)}
                  className={cn(
                    "h-9 rounded-full px-4 text-[13px] font-medium transition-[background-color,color,box-shadow]",
                    period === p.key ? "bg-white text-slate-900 shadow-[0_2px_10px_rgba(15,23,42,0.10)]" : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <WhatsAppQrButton className="flex size-10 items-center justify-center rounded-full bg-white text-slate-600 shadow-[0_2px_10px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/60 hover:text-slate-900" />
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
          {/* Keyed on the period on screen: new figures fade in instead of jumping. */}
          <div key={loadedPeriod ?? "none"} className={cn("animate-in fade-in-0 space-y-4 transition-opacity duration-200", stale && "opacity-60")} aria-busy={stale && !error}>
            <AttentionTiles data={data} allowed={allowed} nowMs={nowMs} />
            <TasksSection tasks={data.tasks} teamTasks={data.teamTasks} zone={data.period.timeZone} allowed={allowed} nowMs={nowMs} />
            <KpiTiles data={data} allowed={allowed} />
            {/* One grid, no duplicate DOM: phones read follow-ups, funnel, source, team; from lg the mock's two rows. */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={cn("order-1 min-w-0 lg:order-3", !data.team && "lg:col-span-2")}><FollowUpsSection data={data} allowed={allowed} /></div>
              <div className="order-2 min-w-0 lg:order-1"><FunnelSection data={data} allowed={allowed} canSetStages={canSetStages} /></div>
              <div className="order-3 min-w-0 lg:order-2"><SourceSection data={data} allowed={allowed} /></div>
              {data.team ? <div className="order-4 min-w-0"><TeamSection data={data} /></div> : null}
            </div>
            <SpendSection data={data} allowed={allowed} onShowMonth={() => selectPeriod("month")} />
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
